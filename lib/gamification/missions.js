// lib/gamification/missions.js
//
// Three fixed daily missions, evaluated per calendar day (UTC): 'learn'
// (engaged with Teach/module content today), 'practice' (submitted a
// graded attempt today, any format), 'pass' (cleared
// lib/adaptive/scoring.js's PASSING_SCORE_PCT on an attempt today). Not a
// configurable content system -- these three cover "showed up," "did the
// work," and "did it well," which is what a daily UPSC prep habit actually
// needs reinforcing.
//
// recordMission is the single entry point every route calls right after
// the real action happens (a Teach view, a graded attempt) -- it no-ops
// silently past the first completion of a given mission on a given day, so
// callers never need to check "did I already record this" themselves.
//
// Seeds vs. XP (Bloom Knowledge Forest): `seeds` (db/schema.js's
// playerState.seeds) is the spendable, effort-earned currency -- what this
// file used to call `xp`. "XP" as a user-facing label now means account
// age instead (accountAgeXp below, derived from authUsers.createdAt, never
// stored/incremented) -- two genuinely different things that happened to
// share a name before.

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db.js";
import { dailyMissionLog, playerState } from "../../db/schema.js";
import { grantRandomItem } from "./items.js";

export const MISSION_DEFS = [
  { key: "learn", label: "Study something new", description: "View or generate Teach content for at least one topic." },
  { key: "practice", label: "Practice a question", description: "Submit at least one graded attempt (any format)." },
  { key: "pass", label: "Clear the passing bar", description: "Score 33% or higher on a graded attempt." },
];

export const SEEDS_PER_MISSION = 20;

// Awarded once, the first time a subtopic's growth stage ratchets into
// "mastered_tree" (see lib/adaptive/masteryUpdate.js) -- bearing fruit is a
// bigger, one-time moment, not a daily habit rep, so it's weighted higher
// than a single mission.
export const SEEDS_PER_MASTERED_TOPIC = 50;

// Below this, a student can't yet self-select/change their onboarding track
// (see app/api/player/track/route.js) -- reuses seeds as the unlock gate
// rather than a separate currency, ~10 missions' worth.
export const TRACK_SWITCH_SEEDS_THRESHOLD = 200;

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

/** Days since the account was created (Supabase Auth's own createdAt, not a column this app owns) -- what "XP" displays now, purely as a read-time derivation. */
export function accountAgeXp(createdAt) {
  if (!createdAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
}

/**
 * Adds `amount` seeds to a user's balance, creating the playerState row if
 * it doesn't exist yet. Shared by bumpStreakAndSeeds (mission completion)
 * and lib/adaptive/masteryUpdate.js (a subtopic bearing fruit) -- the one
 * place seeds are ever incremented, so both callers stay consistent.
 */
export async function grantSeeds(userId, amount) {
  const [existing] = await db.select().from(playerState).where(eq(playerState.userId, userId));
  if (!existing) {
    await db.insert(playerState).values({ userId, seeds: amount });
    return;
  }
  await db.update(playerState).set({ seeds: existing.seeds + amount }).where(eq(playerState.userId, userId));
}

/**
 * Removes up to `amount` seeds from a user's balance, floored at 0 -- a
 * balance can never go negative, and never draining more than the loser
 * actually has is the point (PvP arena loot is a bounded wager, not a debt).
 * Returns how many seeds were actually taken, which is what the caller
 * (lib/gamification/pvp.js's resolveAttack) grants to the winner -- so the
 * winner never receives more than the loser genuinely lost.
 */
export async function deductSeeds(userId, amount) {
  const [existing] = await db.select().from(playerState).where(eq(playerState.userId, userId));
  const current = existing?.seeds ?? 0;
  const taken = Math.min(current, amount);
  if (taken <= 0) return 0;
  if (!existing) return 0; // nothing to deduct from a row that doesn't exist yet
  await db.update(playerState).set({ seeds: current - taken }).where(eq(playerState.userId, userId));
  return taken;
}

async function bumpStreakAndSeeds(userId) {
  const today = todayUtc();
  const [existing] = await db.select().from(playerState).where(eq(playerState.userId, userId));

  if (!existing) {
    await db.insert(playerState).values({ userId, seeds: SEEDS_PER_MISSION, currentStreakDays: 1, longestStreakDays: 1, lastActivityDate: today });
    return;
  }
  if (existing.lastActivityDate === today) {
    // Already active today (this is a later mission completing the same
    // day) -- add seeds, streak day count doesn't change twice in one day.
    await db.update(playerState).set({ seeds: existing.seeds + SEEDS_PER_MISSION }).where(eq(playerState.userId, userId));
    return;
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const continuedStreak = existing.lastActivityDate === yesterday;
  const nextStreak = continuedStreak ? existing.currentStreakDays + 1 : 1;
  await db
    .update(playerState)
    .set({
      seeds: existing.seeds + SEEDS_PER_MISSION,
      currentStreakDays: nextStreak,
      longestStreakDays: Math.max(existing.longestStreakDays, nextStreak),
      lastActivityDate: today,
    })
    .where(eq(playerState.userId, userId));
}

/**
 * Records one mission-relevant action for today. Returns { newlyCompleted,
 * item } -- item is the granted playerItems row when newlyCompleted is
 * true, otherwise null (already completed today, a plain repeat action).
 */
export async function recordMission(userId, missionKey) {
  if (!MISSION_DEFS.some((m) => m.key === missionKey)) throw new Error(`Unknown mission key: ${missionKey}`);
  const missionDate = todayUtc();

  const inserted = await db
    .insert(dailyMissionLog)
    .values({ userId, missionDate, missionKey })
    .onConflictDoNothing({ target: [dailyMissionLog.userId, dailyMissionLog.missionDate, dailyMissionLog.missionKey] })
    .returning();
  if (!inserted.length) return { newlyCompleted: false, item: null }; // already completed today

  const item = await grantRandomItem(userId, missionKey);
  await db.update(dailyMissionLog).set({ rewardItemId: item.id }).where(and(eq(dailyMissionLog.userId, userId), eq(dailyMissionLog.missionDate, missionDate), eq(dailyMissionLog.missionKey, missionKey)));
  await bumpStreakAndSeeds(userId);

  return { newlyCompleted: true, item };
}

/**
 * Same as recordMission, but never throws -- every call site is inside a
 * route whose real job (grading an answer, serving a lesson) must not fail
 * because the gamification layer had a hiccup. Returns null on error
 * instead of propagating it.
 */
export async function recordMissionSafe(userId, missionKey) {
  try {
    return await recordMission(userId, missionKey);
  } catch (err) {
    console.error(`recordMission(${missionKey}) failed:`, err);
    return null;
  }
}

/** Today's mission list with completed:boolean, for the dashboard widget. */
export async function todaysMissionStatus(userId) {
  const missionDate = todayUtc();
  const rows = await db.select({ missionKey: dailyMissionLog.missionKey }).from(dailyMissionLog).where(and(eq(dailyMissionLog.userId, userId), eq(dailyMissionLog.missionDate, missionDate)));
  const completedKeys = new Set(rows.map((r) => r.missionKey));
  return MISSION_DEFS.map((m) => ({ ...m, completed: completedKeys.has(m.key) }));
}

/**
 * `xp` in the returned shape is the account-age derivation (accountAgeXp),
 * NOT a stored value -- every caller that used to read playerState.xp as
 * "earned points" should read `.seeds` instead; `.xp` here is display-only
 * tenure.
 */
export async function loadPlayerState(userId) {
  // Raw, read-only SQL against auth.users.created_at -- deliberately NOT a
  // Drizzle-declared column on authUsers (db/schema.js), because
  // drizzle-kit does not skip generating real ALTER-TABLE migrations for
  // that schema just because it's named "auth" (confirmed live: it tried
  // to alter Supabase's own managed auth.users table). A plain SELECT
  // carries none of that risk -- it's not part of what drizzle-kit diffs.
  const [[ps], authRows] = await Promise.all([
    db.select().from(playerState).where(eq(playerState.userId, userId)),
    db.execute(sql`select created_at from auth.users where id = ${userId}`),
  ]);
  const xp = accountAgeXp(authRows[0]?.created_at);

  if (!ps) return { userId, xp, seeds: 0, currentStreakDays: 0, longestStreakDays: 0, lastActivityDate: null, lockdownGraceUntil: null };
  return { ...ps, xp };
}
