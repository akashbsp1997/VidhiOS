// 60s, not the previous 150 -- a request now does at most ONE AI phase (see
// STAGE_REQUIRES/nextMissingPhase below), individually bounded by
// lib/ai/client.js's 45s AI_TIMEOUT_MS. 60s covers one full
// timeout-and-fail attempt plus DB overhead with margin; the days of one
// request running core + two practice calls + an image call back to back
// (and needing 150s to have a chance of finishing) are over -- see
// lib/ai/generateLesson.js's header comment for why that was the actual
// root cause of this session's recurring finish_reason:"length"/timeout
// failures, not just undersized token budgets.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, sources, lessons, mastery, subjects } from "../../../db/schema.js";
import { generateCoreContent, generatePracticeContent, generateLessonImage } from "../../../lib/ai/generateLesson.js";
import { casesSeed } from "../../../db/seed/cases.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { getSubjectConfig } from "../../../lib/subjects/config.js";
import { labeledSourceExcerptBlocks } from "../../../lib/ai/contentGrounding.js";
import { loadPaperLockMap } from "../../../lib/adaptive/lockState.js";
import { isSubjectUnlocked, checkLockdown } from "../../../lib/adaptive/subjectUnlockState.js";
import { recordMissionSafe } from "../../../lib/gamification/missions.js";

const VALID_STAGES = ["teach", "grasp", "remember", "test"];

// Which AI phases must exist before a given stage can render. "test" has no
// entry (falls back to []) -- it never needed lessons content and still
// doesn't.
const STAGE_REQUIRES = {
  teach: ["core"],
  grasp: ["core", "practice"],
  remember: ["core", "practice", "image"],
};

// Returns the single next phase that needs to run to satisfy `stage`, or
// null if `stage` is already fully satisfied by `row`. Never returns more
// than one phase -- a caller that jumped straight from Teach to Remember
// (no stage-nav gating exists in the UI) gets back the *first* missing
// phase (core, if row doesn't exist yet) and must re-fetch to discover the
// next one, rather than this function trying to run several phases in one
// call.
function nextMissingPhase(row, requiredPhases, stage, force) {
  for (const phase of requiredPhases) {
    if (phase === "core" && (!row || (force && stage === "teach"))) return "core";
    if (phase === "practice" && (!row?.practiceGeneratedAt || (force && stage === "grasp"))) return "practice";
    if (phase === "image" && (!row?.visualImageDataUri || (force && stage === "remember"))) return "image";
  }
  return null;
}

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const subtopicId = searchParams.get("subtopicId");
  const force = searchParams.get("force") === "true";
  const stage = searchParams.get("stage") || "teach";
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
    const lockInfo = lockMap.get(subtopicId);
    if (lockInfo?.locked) {
      return NextResponse.json({ error: "locked", ...lockInfo }, { status: 403 });
    }

    // Awaited (not fire-and-forget) -- a serverless function isn't
    // guaranteed to keep running background work after the response is
    // sent, and recordMissionSafe already swallows its own errors so this
    // can never fail the real request.
    await recordMissionSafe(userId, "learn");

    const subjectRows = await db.select().from(subjects).where(eq(subjects.id, subtopicRow.subjectId));
    const subjectDisplayName = subjectRows[0]?.displayName ?? subtopicRow.subjectId;

    const existingRows = await db.select().from(lessons).where(eq(lessons.subtopicId, subtopicId));
    const row = existingRows[0];

    const phase = nextMissingPhase(row, STAGE_REQUIRES[stage] ?? [], stage, force);

    if (phase === null) {
      return NextResponse.json({ subtopicId, subtopicText: subtopicRow.topicText, subjectDisplayName, ...row, ready: true, cached: true });
    }

    const subjectConfig = getSubjectConfig(subtopicRow.subjectId);

    if (phase === "core") {
      const srcRows = await db.select().from(sources).where(eq(sources.subtopicId, subtopicId));
      const sourceExcerpts = labeledSourceExcerptBlocks(srcRows);
      const caseAnchors = casesSeed
        .filter((c) => c.topics.includes(subtopicId))
        .map((c) => ({ case: c.case, point: c.point }));

      const core = await generateCoreContent({ subtopicText: subtopicRow.topicText, sourceExcerpts, caseAnchors, subjectConfig });

      const [saved] = await db
        .insert(lessons)
        .values({ subtopicId, ...core })
        .onConflictDoUpdate({ target: lessons.subtopicId, set: { ...core, generatedAt: new Date() } })
        .returning();

      return NextResponse.json({
        subtopicId,
        subtopicText: subtopicRow.topicText,
        subjectDisplayName,
        ...saved,
        ready: false,
        nextPhase: "practice",
      });
    }

    if (phase === "practice") {
      const core = { teachContent: row.teachContent, keyProvisions: row.keyProvisions, caseLaw: row.caseLaw };
      const practice = await generatePracticeContent({ subtopicText: subtopicRow.topicText, core, subjectConfig });

      const [saved] = await db
        .update(lessons)
        .set({ ...practice, practiceGeneratedAt: new Date() })
        .where(eq(lessons.subtopicId, subtopicId))
        .returning();

      const ready = stage !== "remember";
      return NextResponse.json({
        subtopicId,
        subtopicText: subtopicRow.topicText,
        subjectDisplayName,
        ...saved,
        ready,
        nextPhase: ready ? null : "image",
      });
    }

    // phase === "image"
    const visualImageDataUri = await generateLessonImage({ subtopicText: subtopicRow.topicText, visualOutline: row.visualOutline });

    const [saved] = await db
      .update(lessons)
      .set({ visualImageDataUri })
      .where(eq(lessons.subtopicId, subtopicId))
      .returning();

    return NextResponse.json({ subtopicId, subtopicText: subtopicRow.topicText, subjectDisplayName, ...saved, ready: true, nextPhase: null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { subtopicId, stage } = await request.json();
    if (!subtopicId || !VALID_STAGES.includes(stage)) {
      return NextResponse.json({ error: "subtopicId and a valid stage are required" }, { status: 400 });
    }

    const existingRows = await db
      .select()
      .from(mastery)
      .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    if (existingRows[0]) {
      await db
        .update(mastery)
        .set({ stage })
        .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    } else {
      await db.insert(mastery).values({ userId, subtopicId, stage });
    }

    return NextResponse.json({ subtopicId, stage });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
