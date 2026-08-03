// app/api/book/route.js
//
// "Create the database as if contents in a book -- study material that's
// regularly updated with current affairs additions and static material
// updates whenever required." Deliberately a COMPILED VIEW over data that
// already exists, not a new denormalized "book" table: lesson_modules'
// teachContent is already the static chapter content (rarely regenerated --
// see the existing force=true regeneration in app/api/module-lesson), and
// current_affairs_items already grows daily and is already tagged to real
// subtopics (lib/ai/currentAffairs.js). A separate stored copy would just
// be a second source of truth that needs syncing; querying both fresh at
// read time means the current-affairs "annex" is ALWAYS as current as
// today's digest with zero extra plumbing, and the static chapters are
// exactly whatever's actually cached -- there's nothing to fall out of
// sync. GET-only, no AI calls.
export const maxDuration = 20;

import { NextResponse } from "next/server";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, subjects, lessonModules, currentAffairsItems } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { isSubjectUnlocked } from "../../../lib/adaptive/subjectUnlockState.js";
import { loadPaperLockMap } from "../../../lib/adaptive/lockState.js";

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const subtopicId = searchParams.get("subtopicId");
  if (!subtopicId) return NextResponse.json({ error: "subtopicId is required" }, { status: 400 });

  try {
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

    const [subjectRow] = await db.select({ displayName: subjects.displayName }).from(subjects).where(eq(subjects.id, subtopicRow.subjectId));

    const moduleRows = await db
      .select()
      .from(lessonModules)
      .where(eq(lessonModules.subtopicId, subtopicId))
      .orderBy(asc(lessonModules.orderIndex));

    // Only chapters the student has actually reached (teachContent
    // generated) -- a book shouldn't spoil not-yet-unlocked modules.
    const chapters = moduleRows
      .filter((m) => m.teachContent)
      .map((m) => ({
        moduleId: m.id,
        orderIndex: m.orderIndex,
        title: m.title,
        teachContent: m.teachContent,
        keyPoints: m.keyPoints,
        lastUpdated: m.generatedAt,
      }));

    // The living current-affairs annex -- every digest item ever tagged to
    // this subtopic, newest first, entirely independent of when the static
    // chapters above were last generated.
    const caRows = await db
      .select()
      .from(currentAffairsItems)
      .where(sql`${subtopicId} = ANY(${currentAffairsItems.relatedSubtopicIds})`)
      .orderBy(desc(currentAffairsItems.publishedDate))
      .limit(50);

    return NextResponse.json({
      subtopicId,
      topicText: subtopicRow.topicText,
      subjectDisplayName: subjectRow?.displayName ?? subtopicRow.subjectId,
      chapters,
      currentAffairsUpdates: caRows.map((r) => ({
        id: r.id,
        publishedDate: r.publishedDate,
        title: r.title,
        summary: r.summary,
        sourceUrl: r.sourceUrl,
        sourceName: r.sourceName,
      })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
