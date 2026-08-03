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
  // Deliberately NOT touching retentionEaseFactor here -- growing it
  // meaningfully needs a dedicated "this was a spaced revision" signal
  // (decay.js's applyRevision()), which the app doesn't have a UI moment
  // for yet (the planned Phase G4 revision queue is the natural home for
  // that call, not every ordinary graded attempt).
  const growthStage = higherStage(existing?.growthStage ?? "seed", growthStageForScore(newMasteryScore));
  const lastRetentionCheckpoint = { score: newMasteryScore, at: new Date().toISOString() };

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
    });
  }

  return { masteryScore: newMasteryScore, currentTier: newTier, growthStage };
}
