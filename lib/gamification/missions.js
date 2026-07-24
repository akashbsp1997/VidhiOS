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

import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { dailyMissionLog, playerState } from "../../db/schema.js";
import { grantRandomItem } from "./items.js";

export const MISSION_DEFS = [
  { key: "learn", label: "Study something new", description: "View or generate Teach content for at least one topic." },
  { key: "practice", label: "Practice a question", description: "Submit at least one graded attempt (any format)." },
  { key: "pass", label: "Clear the passing bar", description: "Score 33% or higher on a graded attempt." },
];

const XP_PER_MISSION = 20;

// Below this, a student can't yet self-select/change their onboarding track
// (see app/api/player/track/route.js) -- reuses the existing xp field as the
// unlock gate rather than a separate currency, ~10 missions' worth.
export const TRACK_SWITCH_XP_THRESHOLD = 200;

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

async function bumpStreakAndXp(userId) {
  const today = todayUtc();
  const [existing] = await db.select().from(playerState).where(eq(playerState.userId, userId));

  if (!existing) {
    await db.insert(playerState).values({ userId, xp: XP_PER_MISSION, currentStreakDays: 1, longestStreakDays: 1, lastActivityDate: today });
    return;
  }
  if (existing.lastActivityDate === today) {
    // Already active today (this is a later mission completing the same
    // day) -- add XP, streak day count doesn't change twice in one day.
    await db.update(playerState).set({ xp: existing.xp + XP_PER_MISSION }).where(eq(playerState.userId, userId));
    return;
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const continuedStreak = existing.lastActivityDate === yesterday;
  const nextStreak = continuedStreak ? existing.currentStreakDays + 1 : 1;
  await db
    .update(playerState)
    .set({
      xp: existing.xp + XP_PER_MISSION,
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
  await bumpStreakAndXp(userId);

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

export async function loadPlayerState(userId) {
  const [ps] = await db.select().from(playerState).where(eq(playerState.userId, userId));
  return ps ?? { userId, xp: 0, currentStreakDays: 0, longestStreakDays: 0, lastActivityDate: null, lockdownGraceUntil: null };
}
