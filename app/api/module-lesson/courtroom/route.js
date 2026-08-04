// app/api/module-lesson/courtroom/route.js
//
// Courtroom Mode -- an optional, single self-contained AI call (same
// discipline as app/api/module-lesson/scene), generated once per module,
// cached forever in lesson_modules.courtroomScene. Additionally gated
// (beyond the usual Remember-stage-unlocked check every enrichment route
// already enforces) on this module's subtopic having at least one real,
// verified case in db/seed/cases.js -- the existing signal tying a
// subtopic to real case law, reused rather than a new per-module AI
// classification. Currently only Law Optional subtopics have casesSeed
// entries, so Courtroom Mode is only reachable there for now.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { subtopics, lessonModules, mastery } from "../../../../db/schema.js";
import { generateModuleCourtroom } from "../../../../lib/ai/generateModules.js";
import { casesSeed } from "../../../../db/seed/cases.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { getSubjectConfig } from "../../../../lib/subjects/config.js";
import { isSubjectUnlocked, checkLockdown } from "../../../../lib/adaptive/subjectUnlockState.js";
import { loadPaperLockMap } from "../../../../lib/adaptive/lockState.js";
import { isStageUnlocked } from "../../../../lib/adaptive/unlocks.js";

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const subtopicId = searchParams.get("subtopicId");
  const moduleIndex = Number(searchParams.get("moduleIndex") ?? 0);
  if (!subtopicId) return NextResponse.json({ error: "subtopicId is required" }, { status: 400 });

  try {
    const lockdown = await checkLockdown(userId);
    if (lockdown) return NextResponse.json({ error: "locked_down", ...lockdown }, { status: 403 });

    const subtopicRows = await db.select().from(subtopics).where(eq(subtopics.id, subtopicId));
    const subtopicRow = subtopicRows[0];
    if (!subtopicRow) return NextResponse.json({ error: `Unknown subtopic: ${subtopicId}` }, { status: 404 });

    if (!(await isSubjectUnlocked(userId, subtopicRow.subjectId))) {
      return NextResponse.json({ error: "subject_locked" }, { status: 403 });
    }
    const lockMap = await loadPaperLockMap(userId, subtopicRow.subjectId, subtopicRow.paper);
    if (lockMap.get(subtopicId)?.locked) {
      return NextResponse.json({ error: "locked", ...lockMap.get(subtopicId) }, { status: 403 });
    }

    // First match by seed-array order -- a subtopic can have more than one
    // tagged case (e.g. two cases sharing the same doctrine), this module
    // dramatizes exactly one, deterministically, not a random pick each visit.
    const anchor = casesSeed.find((c) => c.topics.includes(subtopicId));
    if (!anchor) return NextResponse.json({ error: "no_case_law" }, { status: 409 });

    const moduleRows = await db
      .select()
      .from(lessonModules)
      .where(and(eq(lessonModules.subtopicId, subtopicId), eq(lessonModules.orderIndex, moduleIndex)));
    const moduleRow = moduleRows[0];
    if (!moduleRow) return NextResponse.json({ error: `No module at index ${moduleIndex} for subtopic ${subtopicId}` }, { status: 404 });
    if (!moduleRow.teachContent) return NextResponse.json({ error: "This module's Teach content isn't ready yet." }, { status: 409 });

    const masteryRows = await db.select().from(mastery).where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    const unlockedStage = masteryRows[0]?.moduleProgress?.[String(moduleRow.id)]?.highestStage ?? "teach";
    if (!isStageUnlocked("remember", unlockedStage)) {
      return NextResponse.json({ error: "stage_locked", requiredStage: unlockedStage }, { status: 403 });
    }

    if (moduleRow.courtroomScene) {
      return NextResponse.json({ scene: moduleRow.courtroomScene, cached: true });
    }

    const subjectConfig = getSubjectConfig(subtopicRow.subjectId);
    const scene = await generateModuleCourtroom({
      subtopicText: subtopicRow.topicText,
      moduleTitle: moduleRow.title,
      teachContent: moduleRow.teachContent,
      caseName: anchor.case,
      casePoint: anchor.point,
      subjectConfig,
    });
    const [saved] = await db.update(lessonModules).set({ courtroomScene: scene }).where(eq(lessonModules.id, moduleRow.id)).returning();
    return NextResponse.json({ scene: saved.courtroomScene, cached: false });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
