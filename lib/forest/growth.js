// lib/forest/growth.js
//
// Pure growth-stage/health lookup for the Bloom Knowledge Forest, Phase G1
// (see the design doc, §12) -- two independent axes composited, not one
// variable: growth stage ratchets on the peak masteryScore ever reached
// and never reverses; health reflects *current* decayed retention
// (lib/forest/decay.js) relative to that stage's own threshold. No DB
// access, no AI calls.

import { retention } from "./decay.js";

// Thresholds are against masteryScore's existing 0-1 scale (see
// lib/adaptive/engine.js's updateMastery) -- deliberately reusing that
// scale rather than inventing a second one. Ordered ascending; a stage's
// own threshold is also what growth.js's health lookup treats as "100%
// healthy for a topic at this stage" (see healthForRetention).
export const GROWTH_STAGES = [
  { id: "seed", label: "Seed", minScore: 0 },
  { id: "sprout", label: "Sprout", minScore: 0.15 },
  { id: "sapling", label: "Sapling", minScore: 0.3 },
  { id: "young_tree", label: "Young Tree", minScore: 0.45 },
  { id: "healthy_tree", label: "Healthy Tree", minScore: 0.6 },
  { id: "blooming_tree", label: "Blooming Tree", minScore: 0.78 },
  { id: "mastered_tree", label: "Mastered Tree", minScore: 0.92 },
];

// Ordered ascending by minFraction -- fraction is current retention
// divided by the growth stage's own threshold (see healthForRetention),
// so a Seed sitting at its own (low) bar reads as "healthy," not
// permanently withered just for being young.
export const HEALTH_STATES = [
  { id: "dormant", label: "Dormant", minFraction: 0 },
  { id: "bare", label: "Bare branches", minFraction: 0.2 },
  { id: "falling", label: "Falling leaves", minFraction: 0.45 },
  { id: "yellow", label: "Yellow leaves", minFraction: 0.7 },
  { id: "healthy", label: "Healthy leaves", minFraction: 0.9 },
];

function lastMatching(ladder, key, value) {
  let current = ladder[0];
  for (const step of ladder) {
    if (value >= step[key]) current = step;
    else break;
  }
  return current;
}

/** masteryScore (0-1) -> the growth stage id that score alone would justify. Pure lookup -- does NOT ratchet; callers combine with higherStage() against the row's stored growthStage to get the real (never-decreasing) value. */
export function growthStageForScore(masteryScore) {
  return lastMatching(GROWTH_STAGES, "minScore", masteryScore ?? 0).id;
}

function stageRank(stageId) {
  const i = GROWTH_STAGES.findIndex((s) => s.id === stageId);
  return i === -1 ? 0 : i;
}

/** Ratchet helper: whichever of two growth stage ids ranks higher. Never returns a lower stage than either input -- this is what keeps growthStage a high-water mark when a caller writes masteryScore's newly-derived stage back over the stored one. */
export function higherStage(stageIdA, stageIdB) {
  return stageRank(stageIdA) >= stageRank(stageIdB) ? stageIdA : stageIdB;
}

/** The masteryScore threshold a given growth stage id represents (0 if unknown). */
export function stageThreshold(stageId) {
  return GROWTH_STAGES.find((s) => s.id === stageId)?.minScore ?? 0;
}

/** currentRetention and stageThreshold both 0-1. */
export function healthForRetention(currentRetention, stageThresholdValue) {
  const fraction = stageThresholdValue > 0 ? Math.min(1, currentRetention / stageThresholdValue) : currentRetention > 0 ? 1 : 0;
  return lastMatching(HEALTH_STATES, "minFraction", fraction).id;
}

/**
 * Combines the growth ladder and the decay curve into the full derived
 * state for one mastery row -- what a read-time API handler (or the
 * eventual forest UI) actually needs, all in one pure call.
 *
 * @param {{growthStage: string, checkpointScore?: number, checkpointAt?: string|Date|null, easeFactor?: number, now?: Date}} params
 */
export function deriveForestState({ growthStage, checkpointScore, checkpointAt, easeFactor, now = new Date() }) {
  const stage = growthStage || "seed";
  const threshold = stageThreshold(stage) || 0.01; // avoid a divide-by-zero at the Seed floor
  if (!checkpointAt || !(checkpointScore > 0)) {
    // Never attempted, or no checkpoint recorded yet -- nothing to decay,
    // and nothing to call "healthy" either.
    return { growthStage: stage, health: "dormant", retention: 0, daysSince: null };
  }
  const daysSince = Math.max(0, (now.getTime() - new Date(checkpointAt).getTime()) / 86_400_000);
  const currentRetention = retention({ checkpointScore, daysSince, easeFactor });
  return { growthStage: stage, health: healthForRetention(currentRetention, threshold), retention: currentRetention, daysSince };
}
