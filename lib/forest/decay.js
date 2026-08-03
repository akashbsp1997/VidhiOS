// lib/forest/decay.js
//
// Pure retention/decay math for the Bloom Knowledge Forest, Phase G1 (see
// the design doc, §11) -- no DB access, no AI calls. Reuses
// lib/adaptive/srs.js's SM-2 reviewCard() for the "successful revision"
// side of the model instead of reinventing spaced-repetition math a second
// time; this module only adds the continuous decay curve *between*
// reviews, which srs.js (built for discrete flashcard scheduling) never
// needed.
//
// "peakScore" in the design doc maps to two concrete things here:
// mastery.growthStage (the ratcheted stage, tracked by lib/forest/growth.js
// and never decreasing) is what growth stage renders as; the checkpoint
// score in mastery.lastRetentionCheckpoint (the masteryScore at the moment
// it was last freshly graded) is what actually decays forward through
// time. No separate "all-time peak score" column exists or is needed.

import { reviewCard, DEFAULT_EASE_FACTOR, MIN_EASE_FACTOR } from "../adaptive/srs.js";

// Decay shape exponent -- p > 1 gives slow-then-accelerating falloff
// (matches the product spec: "early decay is slow, long neglect causes
// faster decay"), the opposite of a classic Ebbinghaus curve (p < 1, which
// is steepest immediately after learning and flattens out). See the design
// doc's §11 for why implementing literal Ebbinghaus would fight this spec
// instead of fulfilling it.
export const DECAY_SHAPE_P = 1.6;

// Decay time-constant, in days, at the default (never-reviewed) ease
// factor -- roughly how long an unreinforced topic takes to decay to ~37%
// (1/e) of its checkpoint score. Reviewed topics decay slower in
// proportion to how far retentionEaseFactor has grown above
// DEFAULT_EASE_FACTOR (see tauForEaseFactor).
export const BASE_TAU_DAYS = 6;

// Floor on retention, as a fraction of the checkpoint score -- a topic
// never fully "dies," matching the product's own stage list (Dormant /
// Seedling, not zero). Keeps retention() bounded so growth.js's health
// lookup always has a legible, recoverable state to land on.
export const MIN_RETENTION_FRACTION = 0.05;

/** SM-2 ease factor -> decay time-constant, in days. Higher ease (more successful reviews) means slower decay. */
export function tauForEaseFactor(easeFactor = DEFAULT_EASE_FACTOR) {
  const ease = Math.max(MIN_EASE_FACTOR, easeFactor ?? DEFAULT_EASE_FACTOR);
  return BASE_TAU_DAYS * (ease / DEFAULT_EASE_FACTOR);
}

/**
 * Current retention, as an absolute 0-1 score, `daysSince` days after the
 * checkpoint it decays from. Weibull-shaped (see DECAY_SHAPE_P), not a
 * plain exponential.
 *
 * @param {{checkpointScore: number, daysSince: number, easeFactor?: number}} params
 * @returns {number} 0-1
 */
export function retention({ checkpointScore, daysSince, easeFactor = DEFAULT_EASE_FACTOR }) {
  if (!(checkpointScore > 0) || !(daysSince >= 0)) return 0;
  const tau = tauForEaseFactor(easeFactor);
  const fraction = Math.exp(-Math.pow(daysSince / tau, DECAY_SHAPE_P));
  return checkpointScore * Math.max(MIN_RETENTION_FRACTION, fraction);
}

/**
 * Applies one revision review to a mastery row's decay state: bumps
 * retentionEaseFactor via the existing SM-2 math (reviewCard(), untouched)
 * and partially -- never instantly -- restores health toward the fresh
 * checkpoint score. `quality` is srs.js's 0-5 scale (see its QUALITY
 * export). Returns the new SM-2 fields plus the new health value; the
 * caller is responsible for persisting a fresh checkpoint separately
 * (health here is the *pre-checkpoint-reset* recovery amount, i.e. how
 * much of the gap between current health and the new checkpoint this one
 * review closes).
 *
 * @param {{easeFactor?: number, intervalDays?: number, repetitions?: number, currentHealth: number, checkpointScore: number}} state
 * @param {number} quality
 */
export function applyRevision({ easeFactor, intervalDays, repetitions, currentHealth, checkpointScore }, quality) {
  const srsState = reviewCard({ easeFactor, intervalDays, repetitions }, quality);
  if (quality < 3) {
    // A failed review doesn't earn faster future recovery, but a genuine
    // attempt still counts for something rather than nothing.
    return { ...srsState, health: Math.min(checkpointScore, currentHealth + 0.05 * checkpointScore) };
  }
  // Recovery rate grows with repetitions -- "repeated successful reviews
  // gradually restore full health," not one pass = instant bloom.
  const recoveryRate = Math.min(0.9, 0.25 + srsState.repetitions * 0.15);
  const health = currentHealth + (checkpointScore - currentHealth) * recoveryRate;
  return { ...srsState, health };
}
