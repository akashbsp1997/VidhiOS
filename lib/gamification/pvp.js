// lib/gamification/pvp.js
//
// Bloom Knowledge Forest arena -- users of comparable overall mastery can
// attack each other with a timed MCQ quiz. Deliberately asynchronous, no
// two-player synchronization: a "defense" is a fixed MCQ set a player
// answered, standing as their benchmark until they refresh it; an attacker
// later takes that SAME set and their score is compared against the
// standing benchmark the instant they submit. Nobody ever waits on anybody
// else being online.
//
// What an attack can and can't touch, by explicit design decision: only
// `seeds` (the spendable currency) ever moves between players, and only a
// small, fixed, bounded amount (SEEDS_WAGER). masteryScore, growthStage,
// and decay/health (lib/forest/growth.js, lib/forest/decay.js) are NEVER
// touched by another player's action -- those reflect this student's own
// real exam-prep progress and have to stay theirs alone, win or lose.

import { eq, and, ne, isNull, isNotNull, or, lt, desc, inArray, sql } from "drizzle-orm";
import { db } from "../db.js";
import { playerState, mastery, modelQuestions, pvpAttacks } from "../../db/schema.js";
import { grantSeeds, deductSeeds } from "./missions.js";
import { MATURE_GROWTH_STAGES } from "../forest/estate.js";

export const DEFENSE_QUIZ_SIZE = 5;
export const SEEDS_WAGER = 30;
export const SHIELD_HOURS = 24;
// How close two players' overall mastery has to be to challenge each other
// -- "comparable mastery," not just "anyone." masteryScore is 0-1 (see
// lib/adaptive/engine.js), so 0.15 is a real, fairly tight band.
export const MASTERY_BAND = 0.15;

function stripCorrectIndex(questions) {
  return questions.map(({ questionText, options }) => ({ questionText, options }));
}

/** Average masteryScore across every subtopic this user has attempted anything on. 0 for a brand-new account -- matches app/papers's own "0% if nothing yet" convention. */
export async function computeAvgMastery(userId) {
  const [row] = await db
    .select({ avg: sql`avg(${mastery.masteryScore})`.mapWith(Number) })
    .from(mastery)
    .where(eq(mastery.userId, userId));
  return row?.avg ?? 0;
}

/** How many of this user's subtopics have matured (lib/forest/estate.js) -- the estate-tier input. */
export async function computeMatureCount(userId) {
  const [row] = await db
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(mastery)
    .where(and(eq(mastery.userId, userId), inArray(mastery.growthStage, MATURE_GROWTH_STAGES)));
  return row?.count ?? 0;
}

async function sampleMcqSnapshot(n) {
  // ORDER BY random() over a small, already-cached MCQ pool -- this app's
  // "generate once, cache forever" content, not a fresh AI call per
  // attack/defense (would be both slow and needless cost for a game
  // action). Falls back to fewer than `n` questions rather than erroring
  // if the pool is genuinely thin; callers surface that as "not enough
  // content yet" only when the result is empty. Query-builder throughout
  // (not a raw SELECT string) -- only the ORDER BY itself needs a raw sql
  // fragment, since drizzle has no built-in "random order" helper.
  const rows = await db
    .select({ questionText: modelQuestions.questionText, options: modelQuestions.options, correctIndex: modelQuestions.correctIndex })
    .from(modelQuestions)
    .where(eq(modelQuestions.format, "mcq"))
    .orderBy(sql`random()`)
    .limit(n);
  return rows;
}

/** Issues a fresh defense quiz, overwriting any previous one -- defenseScore goes null until submitDefense grades it (see db/schema.js's playerState comment for why that brief window is accepted). Returns the questions WITHOUT correctIndex. */
export async function startDefense(userId) {
  const questions = await sampleMcqSnapshot(DEFENSE_QUIZ_SIZE);
  if (questions.length < DEFENSE_QUIZ_SIZE) {
    throw new Error("Not enough MCQ content generated yet to set a defense -- practice a few Prelims MCQ rounds first.");
  }
  await db
    .insert(playerState)
    .values({ userId, defenseQuestions: questions, defenseScore: null, defenseSetAt: null })
    .onConflictDoUpdate({ target: playerState.userId, set: { defenseQuestions: questions, defenseScore: null, defenseSetAt: null } });
  return stripCorrectIndex(questions);
}

/** Grades this user's own answers against the defense quiz they were just issued (startDefense), and sets it as their standing benchmark. */
export async function submitDefense(userId, answers) {
  const [ps] = await db.select().from(playerState).where(eq(playerState.userId, userId));
  if (!ps?.defenseQuestions) throw new Error("No defense quiz in progress -- call startDefense first.");
  const score = ps.defenseQuestions.reduce((s, q, i) => s + (answers[i] === q.correctIndex ? 1 : 0), 0);
  await db.update(playerState).set({ defenseScore: score, defenseSetAt: new Date() }).where(eq(playerState.userId, userId));
  return { score, total: ps.defenseQuestions.length };
}

/**
 * Candidate opponents: comparable mastery, has a standing defense, not
 * currently shielded, not self. Deliberately N+1 small per-candidate
 * queries rather than one cross-user aggregate SQL -- this app has no
 * existing precedent for a groupBy-across-all-users query to match, and at
 * this app's real scale (a study tool, not a high-traffic service) a short
 * candidate list computed this way is simple, obviously correct, and fast
 * enough; a real aggregate query would be worth revisiting only if the
 * user base grows large enough for this to matter.
 */
export async function findOpponents(userId, limit = 8) {
  const myAvg = await computeAvgMastery(userId);
  const now = new Date();

  const candidates = await db
    .select({ userId: playerState.userId, defenseScore: playerState.defenseScore })
    .from(playerState)
    .where(
      and(
        ne(playerState.userId, userId),
        isNotNull(playerState.defenseScore),
        or(isNull(playerState.shieldedUntil), lt(playerState.shieldedUntil, now))
      )
    )
    .limit(50); // a generous pre-filter pool before the mastery-band narrows it further

  const withAvg = await Promise.all(
    candidates.map(async (c) => ({ ...c, avgMastery: await computeAvgMastery(c.userId) }))
  );

  return withAvg
    .filter((c) => Math.abs(c.avgMastery - myAvg) <= MASTERY_BAND)
    .sort((a, b) => Math.abs(a.avgMastery - myAvg) - Math.abs(b.avgMastery - myAvg))
    .slice(0, limit)
    .map((c) => ({ userId: c.userId, label: anonymizedLabel(c.userId), avgMastery: c.avgMastery }));
}

/** Deterministic, PII-free display label -- this app has no nickname/profile system, and inventing one is out of scope for the arena itself. */
export function anonymizedLabel(userId) {
  return `Aspirant-${userId.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
}

async function assertEligible(attackerUserId, defenderUserId) {
  if (attackerUserId === defenderUserId) throw new Error("Can't attack yourself.");
  const [defender] = await db.select().from(playerState).where(eq(playerState.userId, defenderUserId));
  if (!defender?.defenseQuestions || defender.defenseScore == null) throw new Error("This player hasn't set a defense yet.");
  if (defender.shieldedUntil && new Date(defender.shieldedUntil) > new Date()) throw new Error("This player is currently shielded.");
  const [myAvg, theirAvg] = await Promise.all([computeAvgMastery(attackerUserId), computeAvgMastery(defenderUserId)]);
  if (Math.abs(myAvg - theirAvg) > MASTERY_BAND) throw new Error("This player is no longer within your comparable-mastery band.");
  return defender;
}

/** Step 1 of an attack -- validates eligibility and returns the defender's current question set WITHOUT correctIndex. */
export async function startAttack(attackerUserId, defenderUserId) {
  const defender = await assertEligible(attackerUserId, defenderUserId);
  return { defenderUserId, questions: stripCorrectIndex(defender.defenseQuestions) };
}

/**
 * Step 2 -- re-validates eligibility (the defender's state may have
 * changed since startAttack: someone else could have attacked them, or
 * they could have refreshed their defense), grades the attacker's answers
 * against the defender's CURRENT questions (never trusts anything the
 * client echoes back), resolves the outcome, and -- only on a clear
 * attacker win -- moves seeds and shields the defender.
 */
export async function resolveAttack(attackerUserId, defenderUserId, answers) {
  const defender = await assertEligible(attackerUserId, defenderUserId);
  const attackerScore = defender.defenseQuestions.reduce((s, q, i) => s + (answers[i] === q.correctIndex ? 1 : 0), 0);
  const defenderScore = defender.defenseScore;

  const outcome = attackerScore > defenderScore ? "win" : attackerScore < defenderScore ? "loss" : "tie";
  let seedsLooted = 0;

  if (outcome === "win") {
    seedsLooted = await deductSeeds(defenderUserId, SEEDS_WAGER);
    if (seedsLooted > 0) await grantSeeds(attackerUserId, seedsLooted);
    await db
      .update(playerState)
      .set({ shieldedUntil: new Date(Date.now() + SHIELD_HOURS * 60 * 60 * 1000) })
      .where(eq(playerState.userId, defenderUserId));
  }

  const [row] = await db
    .insert(pvpAttacks)
    .values({ attackerUserId, defenderUserId, attackerScore, defenderScore, outcome, seedsLooted })
    .returning();

  return { ...row, total: defender.defenseQuestions.length, correctAnswers: defender.defenseQuestions.map((q) => q.correctIndex) };
}

/** Recent battles this user was on either side of, newest first. */
export async function recentBattles(userId, limit = 20) {
  return db
    .select()
    .from(pvpAttacks)
    .where(or(eq(pvpAttacks.attackerUserId, userId), eq(pvpAttacks.defenderUserId, userId)))
    .orderBy(desc(pvpAttacks.createdAt))
    .limit(limit);
}
