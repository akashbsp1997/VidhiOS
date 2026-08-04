// app/api/subtopics/route.js
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, mastery, sources, subjects, pyqs } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { computeDifficultyScore, orderSubtopicsWithinPaper, computeSubtopicLocks, computeSectionLocks } from "../../../lib/adaptive/unlocks.js";
import { isGatedCategory } from "../../../lib/adaptive/subjectUnlocks.js";
import { loadUnlockedSubjectIds, checkLockdown } from "../../../lib/adaptive/subjectUnlockState.js";
import { deriveForestState } from "../../../lib/forest/growth.js";

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Optional (subjectId, paper) filter -- used by the per-paper drill-down
  // page (app/papers/[subjectId]/[paper]/page.jsx) to get just that paper's
  // subtopics. Omitted entirely, this route still returns everything (the
  // old flat-dashboard shape), kept for generality even though nothing in
  // the UI calls it unfiltered anymore since the papers-index redesign.
  const { searchParams } = new URL(request.url);
  const filterSubjectId = searchParams.get("subjectId");
  const filterPaper = searchParams.get("paper") ? Number(searchParams.get("paper")) : null;

  try {
    const allSubjects = await db.select().from(subjects);
    const subjectById = Object.fromEntries(allSubjects.map((s) => [s.id, s]));
    const { unlockedGsIds, optionalSubjectId } = await loadUnlockedSubjectIds(userId);
    const subjectUnlockedForUser = (subjectId) => {
      const category = subjectById[subjectId]?.category;
      if (!isGatedCategory(category)) return true;
      return unlockedGsIds.includes(subjectId) || optionalSubjectId === subjectId;
    };

    // A direct request for one specific, still-subject-locked paper (the
    // per-paper drill-down page) 403s explicitly rather than silently
    // returning an empty list -- the caller needs to know WHY there's
    // nothing to show. The unfiltered "everything" shape instead just
    // excludes subject-locked subtopics below (a general listing has no
    // single subject to complain about).
    if (filterSubjectId && !subjectUnlockedForUser(filterSubjectId)) {
      return NextResponse.json({ error: "subject_locked" }, { status: 403 });
    }

    let allSubtopics = await db.select().from(subtopics);
    allSubtopics = allSubtopics.filter((s) => subjectUnlockedForUser(s.subjectId));
    if (filterSubjectId) allSubtopics = allSubtopics.filter((s) => s.subjectId === filterSubjectId);
    if (filterPaper != null) allSubtopics = allSubtopics.filter((s) => s.paper === filterPaper);
    const allMastery = await db.select().from(mastery).where(eq(mastery.userId, userId));
    const sourceCounts = await db
      .select({ subtopicId: sources.subtopicId, count: sql`count(*)`.mapWith(Number) })
      .from(sources)
      .groupBy(sources.subtopicId);
    const sourceRows = await db
      .select({ subtopicId: sources.subtopicId, sourceTier: sources.sourceTier, ncertLevel: sources.ncertLevel, ncertClass: sources.ncertClass })
      .from(sources);
    const allPyqs = await db.select({ topics: pyqs.topics, marks: pyqs.marks }).from(pyqs);

    const masteryBySubtopic = Object.fromEntries(allMastery.map((m) => [m.subtopicId, m]));
    const sourceCountBySubtopic = Object.fromEntries(sourceCounts.map((s) => [s.subtopicId, s.count]));

    const sourcesBySubtopic = {}; // subtopicId -> [{sourceTier, ncertLevel, ncertClass}]
    for (const row of sourceRows) {
      (sourcesBySubtopic[row.subtopicId] ??= []).push({ sourceTier: row.sourceTier, ncertLevel: row.ncertLevel, ncertClass: row.ncertClass });
    }

    const pyqMarksBySubtopic = {}; // subtopicId -> marks[] -- one pyq can tag multiple subtopics via topics[]
    for (const q of allPyqs) {
      for (const t of q.topics) {
        (pyqMarksBySubtopic[t] ??= []).push(q.marks);
      }
    }

    const withScore = allSubtopics.map((s) => ({
      id: s.id,
      subjectId: s.subjectId,
      subjectDisplayName: subjectById[s.subjectId]?.displayName ?? s.subjectId,
      paper: s.paper,
      section: s.section,
      topicText: s.topicText,
      pyqFrequency: s.pyqFrequency,
      syllabusOrder: s.syllabusOrder,
      masteryScore: masteryBySubtopic[s.id]?.masteryScore ?? 0,
      currentTier: masteryBySubtopic[s.id]?.currentTier ?? 1,
      attemptsCount: masteryBySubtopic[s.id]?.attemptsCount ?? 0,
      stage: masteryBySubtopic[s.id]?.stage ?? "teach",
      // Personal, self-declared -- see db/schema.js's mastery.selfStatus
      // comment. Purely informational here, never affects locking/ordering.
      selfStatus: masteryBySubtopic[s.id]?.selfStatus ?? "not-started",
      sourceCount: sourceCountBySubtopic[s.id] ?? 0,
      difficultyScore: computeDifficultyScore(sourcesBySubtopic[s.id], pyqMarksBySubtopic[s.id]),
      // Bloom Knowledge Forest (lib/forest/growth.js) -- growthStage is the
      // stored ratchet, health is derived fresh on every read from the
      // decay checkpoint so it reflects time passed since the last visit,
      // not just the last write. Purely informational, like selfStatus
      // above: never affects locking/ordering.
      ...(() => {
        const m = masteryBySubtopic[s.id];
        const { growthStage, health, retention, daysSince } = deriveForestState({
          growthStage: m?.growthStage ?? "seed",
          checkpointScore: m?.lastRetentionCheckpoint?.score,
          checkpointAt: m?.lastRetentionCheckpoint?.at,
          easeFactor: m?.retentionEaseFactor,
        });
        // retentionPct/daysSinceCheckpoint: only PlantDetailSheet's "why"
        // line reads these (the List-view health dot doesn't need them) --
        // included here anyway since it's the same already-computed object,
        // not a second call.
        return { growthStage, health, retentionPct: Math.round(retention * 100), daysSinceCheckpoint: daysSince };
      })(),
    }));

    // Study-path order: paper first, then basics -> advanced within it,
    // pyqFrequency as a tie-breaker among similarly-difficulty subtopics
    // (surfaces higher-yield ones first) -- this is purely a dashboard
    // presentation order, unrelated to lib/adaptive/engine.js's separate
    // weighted-random subtopic selection for actual practice sessions.
    // Grouped by (subjectId, paper) so each paper's chain-lock computation
    // (computeSubtopicLocks) only ever compares subtopics within the same
    // paper, matching lib/adaptive/lockState.js's server-side enforcement.
    const byPaperKey = {};
    for (const s of withScore) {
      const key = `${s.subjectId}::${s.paper}`;
      (byPaperKey[key] ??= []).push(s);
    }

    let result = [];
    for (const key of Object.keys(byPaperKey)) {
      const ordered = orderSubtopicsWithinPaper(byPaperKey[key]);
      const masteryScoreById = Object.fromEntries(ordered.map((s) => [s.id, s.masteryScore]));
      const locks = computeSubtopicLocks(ordered, masteryScoreById);
      // Subject-level ("section") gate, composed the same way as
      // lib/adaptive/lockState.js's loadPaperLockMap -- a subtopic is
      // locked if EITHER the subtopic-chain rule or the section rule says
      // so, kept as a distinct lockedBySection flag for UI messaging.
      const sectionLocks = computeSectionLocks(ordered, masteryScoreById);
      result.push(
        ...ordered.map((s) => {
          const lock = locks.get(s.id);
          const sectionLock = sectionLocks.get(s.id);
          return {
            ...s,
            ...lock,
            locked: lock?.locked || sectionLock?.locked,
            lockedBySection: Boolean(sectionLock?.locked),
            sectionLockInfo: sectionLock?.locked
              ? { requiredSection: sectionLock.requiredSection, requiredMasteryPct: sectionLock.requiredMasteryPct, currentMasteryPct: sectionLock.currentMasteryPct }
              : null,
          };
        })
      );
    }
    result.sort(
      (a, b) =>
        a.paper - b.paper ||
        (a.syllabusOrder ?? 0) - (b.syllabusOrder ?? 0) ||
        a.difficultyScore - b.difficultyScore ||
        b.pyqFrequency - a.pyqFrequency ||
        a.id.localeCompare(b.id)
    );

    // Surfaced here (rather than only as a 403 on the routes it blocks) so
    // the dashboard -- almost always the first thing loaded -- can explain
    // up front why Teach/MCQ/mock tests/essay/interview are about to 403,
    // instead of a student discovering it one blocked click at a time.
    const lockdown = await checkLockdown(userId);

    return NextResponse.json({ subtopics: result, lockdown });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
