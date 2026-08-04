// lib/adaptive/unlocks.js
//
// Pure, dependency-free mastery-gating logic -- same DB-free discipline as
// engine.js, so it stays independently testable with plain `node` and the
// DB-touching layer (lib/adaptive/lockState.js) that wraps it stays thin.
//
// Four separate gates live here, one per layer of the app's hierarchy:
//   - subject-within-a-paper (subtopics.section -- e.g. "Polity", "History";
//     the real syllabus's own subject-sized clusters, already grouped
//     consecutively in every seed file, just newly gated as of this)
//   - subtopic-within-a-paper (dashboard study-path order)
//   - module-within-a-subtopic (the hybrid "attempted once AND mastery" rule)
//   - stage-within-a-module (Teach -> Grasp -> Remember -> Test, sequential)
// A fifth gate (adaptive-tier escalation) lives in engine.js instead, since
// it's a pure extension of nextTier's existing escalate/de-escalate logic.

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// A subtopic's PYQ marks range 10-20 (see lib/ai/generateQuestion.js's
// allowedMarks) -- normalizes average marks onto the same 0-1 scale as
// sourceAdvancedness below, so the two signals can be averaged directly.
const MIN_PYQ_MARKS = 10;
const MAX_PYQ_MARKS = 20;

// Per-source advancedness, 0 (most foundational) - 1 (most advanced). NCERT
// sources are further split by the school class range a concept is taught
// at -- a class 6-8 concept is more foundational than a class 11-12 one, a
// real signal beyond the coarser "NCERT vs not" split this used to be.
// Government/official sources sit above the whole NCERT range (a step up
// from school-level, still a single stable/official voice); newspaper
// (current affairs) and private_vendor (exam-prep-specific) sources sit at
// the top -- neither is a stable, standardized text the way NCERT/official
// material is, both require more independent synthesis, so both land in the
// same "advanced pro" tier rather than inventing a 6th bucket to split them.
const NCERT_LEVEL_SCORE = { foundational: 0.05, middle: 0.15, senior: 0.3 };
const SOURCE_TIER_SCORE = { official: 0.65, newspaper: 0.9, private_vendor: 0.9 };

// ncertClass (6-12, from the ingest AI's suggestion + operator verification --
// see lib/ingest/config.js's buildNcertSourceSystem) gives a precise position
// within the NCERT range instead of just one of 3 buckets -- class 6 and
// class 8 both land in the 'foundational' bucket but aren't equally basic.
// Linearly interpolated across the same 0.05-0.3 span NCERT_LEVEL_SCORE's
// buckets sit in, so a source with a known exact class and one with only a
// bucket guess stay on a consistent scale.
const NCERT_CLASS_MIN = 6;
const NCERT_CLASS_MAX = 12;
const NCERT_CLASS_SCORE_MIN = 0.05;
const NCERT_CLASS_SCORE_MAX = 0.3;

/**
 * One source's advancedness score. Prefers the precise ncertClass (6-12)
 * when the operator has verified one; falls back to the coarser ncertLevel
 * bucket, then to 'senior' -- the same default drizzle/0011's backfill used
 * for every pre-existing NCERT source in this app -- when neither is set.
 */
export function sourceScore(source) {
  if (source?.sourceTier === "ncert") {
    if (typeof source.ncertClass === "number") {
      const clamped = Math.min(NCERT_CLASS_MAX, Math.max(NCERT_CLASS_MIN, source.ncertClass));
      const t = (clamped - NCERT_CLASS_MIN) / (NCERT_CLASS_MAX - NCERT_CLASS_MIN);
      return NCERT_CLASS_SCORE_MIN + t * (NCERT_CLASS_SCORE_MAX - NCERT_CLASS_SCORE_MIN);
    }
    return NCERT_LEVEL_SCORE[source.ncertLevel] ?? NCERT_LEVEL_SCORE.senior;
  }
  return SOURCE_TIER_SCORE[source?.sourceTier] ?? 0.5;
}

/**
 * Source-tier-composition half of the difficulty score: the average
 * per-source score (see sourceScore) across a subtopic's sources. Falls
 * back to neutral (0.5) when there's no source data yet, rather than
 * skewing the score on absence of data.
 */
export function sourceAdvancedness(sourceList) {
  if (!sourceList || !sourceList.length) return 0.5;
  return sourceList.reduce((sum, s) => sum + sourceScore(s), 0) / sourceList.length;
}

/**
 * Real-PYQ-marks half of the difficulty score: higher-mark UPSC questions
 * tend to be more analytical/synthesis-level, lower-mark ones more
 * direct-recall. Falls back to the midpoint (15 marks -> 0.5) when a
 * subtopic has no real PYQs yet.
 */
export function pyqAdvancedness(pyqMarksList) {
  const avgMarks = pyqMarksList && pyqMarksList.length ? pyqMarksList.reduce((a, b) => a + b, 0) / pyqMarksList.length : 15;
  return Math.min(1, Math.max(0, (avgMarks - MIN_PYQ_MARKS) / (MAX_PYQ_MARKS - MIN_PYQ_MARKS)));
}

/**
 * Basics-to-advanced score (0 = most foundational, 1 = most advanced),
 * shared by the dashboard and the server-side lock-enforcement layer so
 * there's one computation instead of two copies that can drift.
 * `sourceList` is this subtopic's sources as [{sourceTier, ncertLevel}].
 */
export function computeDifficultyScore(sourceList, pyqMarksList) {
  return (sourceAdvancedness(sourceList) + pyqAdvancedness(pyqMarksList)) / 2;
}

/**
 * Study-path order within a paper: the real syllabus's own hand-ordered
 * sequence first (syllabusOrder -- see db/schema.js's comment on why this
 * beats the computed difficultyScore for "what comes first"), difficultyScore
 * as a tiebreaker for same-syllabusOrder items (e.g. a default of 0 when a
 * subtopic predates the column), pyqFrequency surfacing higher-yield ones
 * first among those, subtopic id as the final deterministic tiebreaker.
 * Expects items already carrying `difficultyScore` (from
 * computeDifficultyScore) and `syllabusOrder`.
 */
export function orderSubtopicsWithinPaper(subtopicsWithScore) {
  return [...subtopicsWithScore].sort(
    (a, b) =>
      (a.syllabusOrder ?? 0) - (b.syllabusOrder ?? 0) ||
      a.difficultyScore - b.difficultyScore ||
      b.pyqFrequency - a.pyqFrequency ||
      a.id.localeCompare(b.id)
  );
}

// 5% for both subtopic-chain and module-chain unlocks -- deliberately far
// below lib/adaptive/scoring.js's PASSING_SCORE_PCT (33%, the display-only
// "would you have passed" framing shown on a graded attempt). That number
// is what a student sees as the target to aim for; this one is the actual
// mechanical gate deciding whether the next subtopic/module opens up, kept
// this low so even a genuinely struggling student (the weakest ~5-10% of
// attempts) clears it after one honest try rather than getting stuck on the
// same module indefinitely -- the real "keep working on this until you're
// actually good at it" pressure is 33%'s Pass/Fail framing and the
// adaptive-tier floor (engine.js's TIER_MASTERY_FLOOR), not this gate.
export const MASTERY_UNLOCK_THRESHOLD = 0.05;

/**
 * Subtopic-chain locks within one already-ordered paper: the first subtopic
 * is always unlocked; subtopic N+1 needs subtopic N's masteryScore to clear
 * the threshold. Returns a Map<subtopicId, lockInfo>.
 */
export function computeSubtopicLocks(orderedSubtopics, masteryScoreById, threshold = MASTERY_UNLOCK_THRESHOLD) {
  const map = new Map();
  orderedSubtopics.forEach((s, i) => {
    const requiredMasteryPct = Math.round(threshold * 100);
    if (i === 0) {
      map.set(s.id, { locked: false, requiredSubtopicId: null, requiredSubtopicText: null, requiredMasteryPct, currentMasteryPct: 0 });
      return;
    }
    const prev = orderedSubtopics[i - 1];
    const prevScore = clamp01(masteryScoreById[prev.id] ?? 0);
    const locked = prevScore < threshold;
    map.set(s.id, {
      locked,
      requiredSubtopicId: locked ? prev.id : null,
      requiredSubtopicText: locked ? prev.topicText : null,
      requiredMasteryPct,
      currentMasteryPct: Math.round(prevScore * 100),
    });
  });
  return map;
}

/**
 * Subject-level ("section") chain locks within one already-ordered paper.
 * `subtopics.section` (e.g. "Polity", "History", "Governance and Social
 * Justice") is the real syllabus's own subject-sized cluster -- already
 * coherent and consecutive in every seed file (see db/schema.js's comment on
 * subtopics.section), just never gated before this. Section order is
 * derived from first-appearance in `orderedSubtopics` (i.e. from
 * syllabusOrder via orderSubtopicsWithinPaper), not a separately stored
 * field -- there's nothing to drift out of sync with. The first section is
 * always unlocked; section N+1 needs section N's AVERAGE masteryScore
 * across its own subtopics to clear the threshold -- averaged rather than
 * "every single one individually", matching this app's existing low/
 * forgiving MASTERY_UNLOCK_THRESHOLD philosophy instead of adding the
 * strictest gate in the app. Returns Map<subtopicId, sectionLockInfo> --
 * every subtopic in the same section shares the same sectionLockInfo.
 */
export function computeSectionLocks(orderedSubtopics, masteryScoreById, threshold = MASTERY_UNLOCK_THRESHOLD) {
  const sectionOrder = [];
  const bySection = new Map();
  for (const s of orderedSubtopics) {
    if (!bySection.has(s.section)) {
      bySection.set(s.section, []);
      sectionOrder.push(s.section);
    }
    bySection.get(s.section).push(s);
  }

  const map = new Map();
  const requiredMasteryPct = Math.round(threshold * 100);
  sectionOrder.forEach((section, i) => {
    const members = bySection.get(section);
    if (i === 0) {
      for (const s of members) map.set(s.id, { locked: false, section, requiredSection: null, requiredMasteryPct, currentMasteryPct: 0 });
      return;
    }
    const prevMembers = bySection.get(sectionOrder[i - 1]);
    const avgScore = clamp01(prevMembers.reduce((sum, s) => sum + clamp01(masteryScoreById[s.id] ?? 0), 0) / prevMembers.length);
    const locked = avgScore < threshold;
    for (const s of members) {
      map.set(s.id, {
        locked,
        section,
        requiredSection: locked ? sectionOrder[i - 1] : null,
        requiredMasteryPct,
        currentMasteryPct: Math.round(avgScore * 100),
      });
    }
  });
  return map;
}

// Stage sequencing within a module: Teach -> Grasp -> Remember -> Test has
// no score to gate on (only Test produces one), so this is a
// sequential-completion gate, not a percent-mastery one.
export const STAGE_ORDER = ["teach", "grasp", "remember", "test"];

export function isStageUnlocked(stage, unlockedStage) {
  return STAGE_ORDER.indexOf(stage) <= STAGE_ORDER.indexOf(unlockedStage || "teach");
}

/**
 * A stage only legitimately "advances" one step past the current high-water
 * mark -- fired only by a stage's own Continue button, never by a tab click
 * jumping ahead. Returns true if targetStage is exactly currentUnlockedStage's
 * successor.
 */
export function validateStageAdvance(currentUnlockedStage, targetStage) {
  return STAGE_ORDER.indexOf(targetStage) === STAGE_ORDER.indexOf(currentUnlockedStage || "teach") + 1;
}

/**
 * Module-chain locks (hybrid rule): module 1 is always unlocked. Module N+1
 * unlocks only when BOTH module N's own Test has been attempted at least
 * once (moduleProgressById, keyed by module id as a string -- jsonb keys are
 * always strings) AND the subtopic's masteryScore clears the threshold.
 * `modules` is [{id, orderIndex}] already in order.
 */
export function computeModuleLocks(modules, moduleProgressById, subtopicMasteryScore, threshold = MASTERY_UNLOCK_THRESHOLD) {
  const map = new Map();
  const requiredMasteryPct = Math.round(threshold * 100);
  const currentMasteryPct = Math.round(clamp01(subtopicMasteryScore ?? 0) * 100);
  modules.forEach((m, i) => {
    if (i === 0) {
      map.set(m.id, { locked: false, reason: null, requiredMasteryPct, currentMasteryPct });
      return;
    }
    const prevId = modules[i - 1].id;
    const prevAttempted = (moduleProgressById?.[String(prevId)]?.testAttempts ?? 0) >= 1;
    const masteryOk = clamp01(subtopicMasteryScore ?? 0) >= threshold;
    const reason = !prevAttempted ? "previous_test_not_attempted" : !masteryOk ? "mastery_below_threshold" : null;
    map.set(m.id, { locked: !!reason, reason, requiredMasteryPct, currentMasteryPct });
  });
  return map;
}
