// app/api/ncert-chapters/route.js
//
// Groups subtopics by the NCERT chapter/book/class that grounds them --
// classwise (6 -> 12), a secondary browsing lens on top of the syllabus,
// NOT a replacement for it. The syllabus stays the primary structure
// (see the Bloom design doc's founding principle: books are sources, not
// the taxonomy) -- this just lets a student browse "by NCERT chapter" when
// that's the mental model they want, using the ncertClass/ncertBook/
// ncertChapter metadata sources.js already captures per row. A subtopic
// can legitimately appear under more than one chapter if more than one
// NCERT source grounds it.
export const maxDuration = 20;

import { NextResponse } from "next/server";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { sources, subtopics, mastery } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { deriveForestState } from "../../../lib/forest/growth.js";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const ncertRows = await db
    .select({
      subtopicId: sources.subtopicId,
      ncertClass: sources.ncertClass,
      ncertBook: sources.ncertBook,
      ncertChapter: sources.ncertChapter,
      topicText: subtopics.topicText,
      section: subtopics.section,
    })
    .from(sources)
    .innerJoin(subtopics, eq(subtopics.id, sources.subtopicId))
    .where(and(eq(sources.sourceTier, "ncert"), isNotNull(sources.ncertClass)));

  const subtopicIds = [...new Set(ncertRows.map((r) => r.subtopicId))];
  const masteryRows = subtopicIds.length
    ? await db.select().from(mastery).where(and(eq(mastery.userId, userId), inArray(mastery.subtopicId, subtopicIds)))
    : [];
  const masteryBySubtopic = Object.fromEntries(masteryRows.map((m) => [m.subtopicId, m]));

  const chapterKey = (r) => `${r.ncertClass}::${r.ncertBook ?? "Unnamed book"}::${r.ncertChapter ?? "Unnamed chapter"}`;
  const byChapter = new Map();
  for (const r of ncertRows) {
    const key = chapterKey(r);
    if (!byChapter.has(key)) {
      byChapter.set(key, { ncertClass: r.ncertClass, ncertBook: r.ncertBook, ncertChapter: r.ncertChapter, subtopics: new Map() });
    }
    const chapter = byChapter.get(key);
    if (!chapter.subtopics.has(r.subtopicId)) {
      const m = masteryBySubtopic[r.subtopicId];
      const { growthStage, health } = deriveForestState({
        growthStage: m?.growthStage ?? "seed",
        checkpointScore: m?.lastRetentionCheckpoint?.score,
        checkpointAt: m?.lastRetentionCheckpoint?.at,
        easeFactor: m?.retentionEaseFactor,
      });
      chapter.subtopics.set(r.subtopicId, {
        subtopicId: r.subtopicId,
        topicText: r.topicText,
        section: r.section,
        masteryScore: m?.masteryScore ?? 0,
        growthStage,
        health,
      });
    }
  }

  const chapters = [...byChapter.values()]
    .map((c) => ({ ...c, subtopics: [...c.subtopics.values()] }))
    .sort((a, b) => (a.ncertClass ?? 0) - (b.ncertClass ?? 0) || (a.ncertBook ?? "").localeCompare(b.ncertBook ?? ""));

  return NextResponse.json({ chapters });
}
