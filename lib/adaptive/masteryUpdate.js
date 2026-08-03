// lib/adaptive/masteryUpdate.js
//
// Applies one graded attempt's score to a (userId, subtopicId)'s mastery row
// -- extracted from what used to be inline in app/api/attempt/route.js's POST
// handler, back when grading was synchronous. Now that grading happens in
// app/api/cron/grade-daily-answers/route.js's nightly batch (see that file),
// this is the piece of the old inline logic that still needs to run once a
// score actually exists -- called once per graded attempt, in the same
// createdAt order the attempts were made in, since updateMastery/pushRecentScore/
// nextTier all read-then-write the row and the EMA/tier math depends on that
// order matching what would have happened if grading were still synchronous.
//
// Deliberately does NOT touch moduleProgress[moduleId].testAttempts -- that's
// bumped immediately at SAVE time (a pure DB write, no AI, no reason to wait
// for grading), directly in app/api/attempt/route.js's POST. This only
// updates the pieces that genuinely depend on the score: masteryScore,
// currentTier, recentScores, attemptsCount, and moduleProgress[moduleId].bestScore01.

import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import { mastery } from "../../db/schema.js";
import { updateMastery, pushRecentScore, nextTier } from "./engine.js";
import { growthStageForScore, higherStage } from "../forest/growth.js";
import { reviewCard, DEFAULT_EASE_FACTOR } from "./srs.js";
import { grantSeeds, SEEDS_PER_MASTERED_TOPIC } from "../gamification/missions.js";

// score01 (this app's 0-1 grading scale) -> srs.js's 0-5 SM-2 quality scale.
// Coarser than the 3-button Again/Good/Easy UI flashcards use (there's no
// separate UI moment here to ask "how did that feel"), but the same scale,
// so reviewCard()'s math is unchanged -- see its QUALITY export.
function qualityFromScore01(score01) {
  if (score01 >= 0.75) return 5;
  if (score01 >= 0.5) return 4;
  return 2;
}

export async function applyGradedScore(userId, subtopicId, moduleId, score01) {
  const existingRows = await db
    .select()
    .from(mastery)
    .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
  const existing = existingRows[0];

  const attemptsSoFar = existing?.attemptsCount ?? 0;
  const oldMastery = existing?.masteryScore ?? 0;
  const newMasteryScore = updateMastery(oldMastery, attemptsSoFar, score01);
  const recentScores = pushRecentScore(existing?.recentScores ?? [], score01);
  const oldTier = existing?.currentTier ?? 1;
  const newTier = nextTier(oldTier, recentScores, newMasteryScore);

  const moduleProgress = { ...(existing?.moduleProgress ?? {}) };
  if (moduleId) {
    const key = String(moduleId);
    const prevEntry = moduleProgress[key] ?? {};
    moduleProgress[key] = { ...prevEntry, bestScore01: Math.max(prevEntry.bestScore01 ?? 0, score01) };
  }

  // Bloom Knowledge Forest (lib/forest/growth.js, lib/forest/decay.js) --
  // a freshly graded attempt is the one real "proof of current
  // understanding" event in the app, so it both ratchets growthStage (never
  // regresses, even on a bad attempt -- see higherStage) and resets the
  // decay checkpoint to decay forward from *this* score, from now.
  //
  // A RETEST specifically (attemptsSoFar > 0, i.e. not the student's first
  // ever attempt on this subtopic) also grows retentionEaseFactor via the
  // same SM-2 math flashcards already use (reviewCard(), untouched) --
  // "retests help the plant grow healthier and blooms stronger" means
  // future decay gets slower the more times a topic has been successfully
  // retested (lib/forest/decay.js's tauForEaseFactor scales directly off
  // this), not that any one retest instantly maxes out health (the
  // checkpoint reset below already gives that "just proved it" moment its
  // due -- ease factor is what compounds across repeat visits). Only
  // easeFactor is persisted, not intervalDays/repetitions -- this app never
  // schedules a "next review date" the way flashcards do, so there's
  // nothing else from SM-2's state this needs to carry forward.
  const growthStage = higherStage(existing?.growthStage ?? "seed", growthStageForScore(newMasteryScore));
  const lastRetentionCheckpoint = { score: newMasteryScore, at: new Date().toISOString() };
  const retentionEaseFactor =
    attemptsSoFar > 0
      ? reviewCard({ easeFactor: existing?.retentionEaseFactor ?? DEFAULT_EASE_FACTOR, intervalDays: 0, repetitions: 0 }, qualityFromScore01(score01))
          .easeFactor
      : (existing?.retentionEaseFactor ?? DEFAULT_EASE_FACTOR);

  if (existing) {
    await db
      .update(mastery)
      .set({
        masteryScore: newMasteryScore,
        attemptsCount: attemptsSoFar + 1,
        currentTier: newTier,
        recentScores,
        lastAttemptAt: new Date(),
        moduleProgress,
        growthStage,
        lastRetentionCheckpoint,
        retentionEaseFactor,
      })
      .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
  } else {
    await db.insert(mastery).values({
      userId,
      subtopicId,
      masteryScore: newMasteryScore,
      attemptsCount: 1,
      currentTier: newTier,
      recentScores,
      lastAttemptAt: new Date(),
      moduleProgress,
      growthStage,
      lastRetentionCheckpoint,
      retentionEaseFactor,
    });
  }

  // Bearing fruit: award seeds once, the moment this subtopic FIRST
  // ratchets into "mastered_tree" -- not on every subsequent attempt at
  // that stage (growthStage never regresses, so this transition can only
  // ever happen once per subtopic per student).
  const justBoreFruit = growthStage === "mastered_tree" && existing?.growthStage !== "mastered_tree";
  if (justBoreFruit) await grantSeeds(userId, SEEDS_PER_MASTERED_TOPIC);

  return { masteryScore: newMasteryScore, currentTier: newTier, growthStage };
}
