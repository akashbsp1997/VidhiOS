// app/api/theme-guide/route.js
//
// GET -> the subject-wise guide (Piece C): GS subtopics grouped by theme
// (their own `section` field -- see lib/subjects/themeGuide.js), each with
// "where to start" (basics-first order, reusing the same difficulty
// scoring the dashboard already computes), "sources to follow" (aggregated
// from the sources already registered against those subtopics, higher-trust
// tiers first), and "what to include in notes" (bullets already generated
// by a real Teach visit -- lessons.keyProvisions or lessonModules.keyPoints
// -- never freshly generated here). Scoped to unlocked GS subjects only,
// matching the rest of the subject-unlock gate.
import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, mastery, sources, subjects, pyqs, lessons, lessonModules } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { computeDifficultyScore } from "../../../lib/adaptive/unlocks.js";
import { groupByTheme } from "../../../lib/subjects/themeGuide.js";
import { sortByTierPriority } from "../../../lib/sources/tiers.js";
import { loadUnlockedSubjectIds } from "../../../lib/adaptive/subjectUnlockState.js";
import { deriveForestState } from "../../../lib/forest/growth.js";

// How many distinct sources / note bullets to surface per theme -- these are
// "get oriented" lists, not an exhaustive dump of everything ever attached.
const MAX_SOURCES_PER_THEME = 8;
const MAX_NOTES_PER_THEME = 10;

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { unlockedGsIds } = await loadUnlockedSubjectIds(userId);
    if (!unlockedGsIds.length) {
      return NextResponse.json({ error: "onboarding_not_complete" }, { status: 409 });
    }

    const subjectRows = await db.select({ id: subjects.id, displayName: subjects.displayName }).from(subjects).where(inArray(subjects.id, unlockedGsIds));
    const subjectById = Object.fromEntries(subjectRows.map((s) => [s.id, s]));

    const gsSubtopics = await db.select().from(subtopics).where(inArray(subtopics.subjectId, unlockedGsIds));
    if (!gsSubtopics.length) {
      return NextResponse.json({ themes: [] });
    }
    const ids = gsSubtopics.map((s) => s.id);

    const masteryRows = await db.select().from(mastery).where(eq(mastery.userId, userId));
    const masteryBySubtopic = Object.fromEntries(masteryRows.map((m) => [m.subtopicId, m]));

    const sourceRows = await db.select().from(sources).where(inArray(sources.subtopicId, ids));
    const sourcesBySubtopic = {};
    for (const row of sourceRows) {
      (sourcesBySubtopic[row.subtopicId] ??= []).push(row);
    }

    const allPyqs = await db.select({ topics: pyqs.topics, marks: pyqs.marks }).from(pyqs);
    const pyqMarksBySubtopic = {};
    for (const q of allPyqs) {
      for (const t of q.topics) {
        if (ids.includes(t)) (pyqMarksBySubtopic[t] ??= []).push(q.marks);
      }
    }

    // Existing generated notes only -- never triggers a new AI call. A
    // subtopic on the legacy lessons flow contributes its keyProvisions; one
    // already decomposed into modules contributes each module's keyPoints
    // (only once that module's Teach phase has actually run).
    const lessonRows = await db.select({ subtopicId: lessons.subtopicId, keyProvisions: lessons.keyProvisions }).from(lessons).where(inArray(lessons.subtopicId, ids));
    const moduleRows = await db
      .select({ subtopicId: lessonModules.subtopicId, keyPoints: lessonModules.keyPoints, generatedAt: lessonModules.generatedAt })
      .from(lessonModules)
      .where(inArray(lessonModules.subtopicId, ids));
    const notesBySubtopic = {};
    for (const row of lessonRows) {
      // lessons.keyProvisions is [{citation, summary}], not flat strings
      // (unlike lessonModules.keyPoints below) -- flatten to one line each.
      const bullets = (row.keyProvisions ?? [])
        .filter((p) => p && typeof p.citation === "string" && typeof p.summary === "string")
        .map((p) => `${p.citation}: ${p.summary}`);
      (notesBySubtopic[row.subtopicId] ??= []).push(...bullets);
    }
    for (const row of moduleRows) {
      if (row.generatedAt) (notesBySubtopic[row.subtopicId] ??= []).push(...(row.keyPoints ?? []));
    }

    const enriched = gsSubtopics.map((s) => ({
      id: s.id,
      subjectId: s.subjectId,
      subjectDisplayName: subjectById[s.subjectId]?.displayName ?? s.subjectId,
      section: s.section,
      topicText: s.topicText,
      pyqFrequency: s.pyqFrequency,
      masteryScore: masteryBySubtopic[s.id]?.masteryScore ?? 0,
      selfStatus: masteryBySubtopic[s.id]?.selfStatus ?? "not-started",
      // Bloom Knowledge Forest (lib/forest/growth.js) -- same read-time
      // derivation as app/api/subtopics/route.js, see its comment.
      health: deriveForestState({
        growthStage: masteryBySubtopic[s.id]?.growthStage ?? "seed",
        checkpointScore: masteryBySubtopic[s.id]?.lastRetentionCheckpoint?.score,
        checkpointAt: masteryBySubtopic[s.id]?.lastRetentionCheckpoint?.at,
        easeFactor: masteryBySubtopic[s.id]?.retentionEaseFactor,
      }).health,
      difficultyScore: computeDifficultyScore(
        sourcesBySubtopic[s.id]?.map((r) => ({ sourceTier: r.sourceTier, ncertLevel: r.ncertLevel, ncertClass: r.ncertClass })),
        pyqMarksBySubtopic[s.id]
      ),
    }));

    const grouped = groupByTheme(enriched);

    const themes = grouped.map((g) => {
      const themeSubtopicIds = g.subtopics.map((s) => s.id);

      const sourcesInTheme = themeSubtopicIds.flatMap((id) => sourcesBySubtopic[id] ?? []);
      const dedupedSources = [];
      const seenTitles = new Set();
      for (const src of sortByTierPriority(sourcesInTheme)) {
        if (seenTitles.has(src.title)) continue;
        seenTitles.add(src.title);
        dedupedSources.push({ title: src.title, url: src.url, sourceTier: src.sourceTier });
        if (dedupedSources.length >= MAX_SOURCES_PER_THEME) break;
      }

      const notesInTheme = themeSubtopicIds.flatMap((id) => notesBySubtopic[id] ?? []).slice(0, MAX_NOTES_PER_THEME);

      return {
        theme: g.theme,
        subjectDisplayName: g.subtopics[0]?.subjectDisplayName ?? "",
        avgMastery: g.avgMastery,
        subtopicCount: g.subtopics.length,
        startHere: g.subtopics.slice(0, 3).map((s) => ({ id: s.id, topicText: s.topicText, masteryScore: s.masteryScore, health: s.health })),
        allSubtopics: g.subtopics.map((s) => ({ id: s.id, topicText: s.topicText, masteryScore: s.masteryScore, selfStatus: s.selfStatus, health: s.health })),
        sourcesToFollow: dedupedSources,
        notesToInclude: notesInTheme,
      };
    });

    return NextResponse.json({ themes });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
