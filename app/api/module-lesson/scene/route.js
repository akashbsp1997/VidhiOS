// app/api/module-lesson/scene/route.js
//
// Time-Scene Challenge -- an optional, single self-contained AI call
// (same discipline as app/api/module-lesson/story). Generated once per
// module, cached forever in lesson_modules.sceneChallenge. Grading is a
// plain known-answer multiple choice, entirely client-side -- never touches
// the overnight batch-grading pipeline.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { subtopics, lessonModules, mastery } from "../../../../db/schema.js";
import { generateModuleScene } from "../../../../lib/ai/generateModules.js";
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

    if (moduleRow.sceneChallenge) {
      return NextResponse.json({ scene: moduleRow.sceneChallenge, cached: true });
    }

    const subjectConfig = getSubjectConfig(subtopicRow.subjectId);
    const scene = await generateModuleScene({
      subtopicText: subtopicRow.topicText,
      moduleTitle: moduleRow.title,
      teachContent: moduleRow.teachContent,
      subjectConfig,
    });
    const [saved] = await db.update(lessonModules).set({ sceneChallenge: scene }).where(eq(lessonModules.id, moduleRow.id)).returning();
    return NextResponse.json({ scene: saved.sceneChallenge, cached: false });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
