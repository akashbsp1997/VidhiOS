// app/api/cron/prepare-next-day/route.js
//
// Wired to Vercel Cron via vercel.json, once nightly, scheduled AFTER
// grade-daily-answers (see that file + vercel.json's schedule gap) since
// this reads the mastery that job just updated. For every onboarded user,
// finds tomorrow's "learn"-type plan topics (lib/adaptive/planState.js's
// getPlanWindow, unchanged/pure) and pre-generates their Teach/Grasp/Remember
// module content (lib/adaptive/moduleContentReady.js's ensureModuleStagePhase,
// same function app/api/module-lesson/route.js's GET calls live) so it's
// already sitting there, cached, before the student wakes up -- see the
// 2026-07-24 overnight-batch-grading change.
//
// Scope: only pre-generates phases for a module that ALREADY has a
// lesson_modules row (i.e. someone has opened this subtopic's module list at
// least once before) and that computeModuleLocks says would actually be
// unlocked given tonight's just-updated mastery. A subtopic nobody has ever
// opened (zero lesson_modules rows -- the AI "plan" decomposition call has
// never run) is left alone; that first-ever plan phase still runs live, on
// demand, the first time the student opens it (see app/api/module-lesson's
// GET, still the fallback path -- this cron doesn't try to guess every topic
// anyone might ever reach next). Also skips "test" -- that phase is
// generated live per-question already (app/api/attempt/route.js), never
// pre-generatable since which exact question a student gets depends on
// per-user attempt history.
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { subjectUnlocks, subtopics, lessonModules, mastery } from "../../../../db/schema.js";
import { getPlanWindow } from "../../../../lib/adaptive/planState.js";
import { dayNumberForDate } from "../../../../lib/adaptive/planEngine.js";
import { planStartDate } from "../../../../lib/adaptive/subjectUnlockState.js";
import { computeModuleLocks } from "../../../../lib/adaptive/unlocks.js";
import { ensureModuleStagePhase, nextMissingModulePhase } from "../../../../lib/adaptive/moduleContentReady.js";
import { getSubjectConfig } from "../../../../lib/subjects/config.js";

// Matches refresh-sources' MAX_PER_RUN=15 batch-size precedent -- each
// missing phase is one AI call with the same ~29s worst-case retry budget,
// shared across this route's 90s maxDuration.
const MAX_PHASES_PER_RUN = 15;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.select({ userId: subjectUnlocks.userId }).from(subjectUnlocks);
  const userIds = [...new Set(rows.map((r) => r.userId))];

  let phasesGenerated = 0;
  const results = [];

  outer: for (const userId of userIds) {
    try {
      const start = await planStartDate(userId);
      if (!start) {
        results.push({ userId, status: "no-plan" });
        continue;
      }

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowDay = dayNumberForDate(start, tomorrow);
      const window = await getPlanWindow(userId, { fromDay: tomorrowDay, toDay: tomorrowDay });
      const day = window?.days?.[0];
      if (!day || day.type !== "learn" || day.topics.length === 0) {
        results.push({ userId, status: "nothing-to-preload" });
        continue;
      }

      for (const topic of day.topics) {
        if (phasesGenerated >= MAX_PHASES_PER_RUN) break outer;

        const [subtopicRow] = await db.select().from(subtopics).where(eq(subtopics.id, topic.id));
        if (!subtopicRow) continue;

        const modules = await db
          .select()
          .from(lessonModules)
          .where(eq(lessonModules.subtopicId, topic.id))
          .orderBy(asc(lessonModules.orderIndex));
        if (!modules.length) continue; // never opened before -- plan phase runs live on first visit, out of scope here

        const [masteryRow] = await db
          .select()
          .from(mastery)
          .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, topic.id)));
        const moduleLocks = computeModuleLocks(modules, masteryRow?.moduleProgress ?? {}, masteryRow?.masteryScore ?? 0);
        const subjectConfig = getSubjectConfig(subtopicRow.subjectId);

        for (const moduleRow of modules) {
          if (phasesGenerated >= MAX_PHASES_PER_RUN) break outer;
          if (moduleLocks.get(moduleRow.id)?.locked) continue;

          let currentRow = moduleRow;
          while (phasesGenerated < MAX_PHASES_PER_RUN) {
            const phase = nextMissingModulePhase(currentRow);
            if (!phase) break;
            currentRow = await ensureModuleStagePhase(currentRow, subtopicRow, subjectConfig, phase, userId);
            phasesGenerated++;
          }
        }
      }
      results.push({ userId, status: "ok" });
    } catch (err) {
      console.error(`prepare-next-day: user ${userId} failed:`, err.message);
      results.push({ userId, status: "error", error: err.message });
    }
  }

  return NextResponse.json({ usersChecked: userIds.length, phasesGenerated, results });
}
