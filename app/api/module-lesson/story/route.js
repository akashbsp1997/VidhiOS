// app/api/module-lesson/story/route.js
//
// Story Mode -- an optional, single self-contained AI call (same "at most
// one AI phase per request" discipline as the main module-lesson route,
// just with nothing further to poll for since there's only one phase here).
// Generated once per module on first request, cached forever after in
// lesson_modules.storyScenes. Not part of the teach/practice/image
// progression chain -- reaching it only requires Remember to already be
// unlocked (re-checked here, not trusted from the client), never gates
// anything else.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { subtopics, lessonModules, mastery } from "../../../../db/schema.js";
import { generateModuleStory } from "../../../../lib/ai/generateModules.js";
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

    if (moduleRow.storyScenes) {
      return NextResponse.json({ scenes: moduleRow.storyScenes, cached: true });
    }

    const subjectConfig = getSubjectConfig(subtopicRow.subjectId);
    const scenes = await generateModuleStory({
      subtopicText: subtopicRow.topicText,
      moduleTitle: moduleRow.title,
      teachContent: moduleRow.teachContent,
      keyPoints: moduleRow.keyPoints,
      subjectConfig,
    });
    const [saved] = await db.update(lessonModules).set({ storyScenes: scenes }).where(eq(lessonModules.id, moduleRow.id)).returning();
    return NextResponse.json({ scenes: saved.storyScenes, cached: false });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
