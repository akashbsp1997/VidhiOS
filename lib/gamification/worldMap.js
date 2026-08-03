// lib/gamification/worldMap.js
//
// The Arena's "map" view -- a virtual world, not a real one. No geolocation
// is ever collected: each student's position is deterministic and purely
// cosmetic, derived from their own userId and overall mastery. The x-axis
// literally IS preparation progress (0 = just started, 1 = deep in the
// Forest), so "nearby on the map" already means "comparable preparation
// level" by construction -- the same MASTERY_BAND lib/gamification/pvp.js
// uses for arena matchmaking, reused here for who else appears on the map
// at all.

import { ne } from "drizzle-orm";
import { db } from "../db.js";
import { playerState } from "../../db/schema.js";
import { computeAvgMastery, computeMatureCount, MASTERY_BAND, anonymizedLabel } from "./pvp.js";
import { estateTierForMatureCount } from "../forest/estate.js";
import { listBadges } from "./items.js";

/** Stable 0..1 pseudo-random value from a string -- same input always gives the same output, so a player's map position doesn't jump around between visits. */
function hashToUnit(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

async function mapEntryFor(userId) {
  const [avgMastery, matureCount, badges] = await Promise.all([computeAvgMastery(userId), computeMatureCount(userId), listBadges(userId)]);
  const estateTier = estateTierForMatureCount(matureCount);
  return {
    userId,
    label: anonymizedLabel(userId),
    avgMastery,
    matureCount,
    estateTier,
    ornaments: badges.map((b) => b.label),
    // x = preparation progress (the map's real axis), y = pure cosmetic
    // scatter so pins at a similar mastery don't all stack on one point.
    x: avgMastery,
    y: hashToUnit(userId),
  };
}

/**
 * This user's own map entry plus everyone else within MASTERY_BAND --
 * "nearby" on a map whose x-axis already is preparation level. Same
 * N+1-small-queries tradeoff as pvp.js's findOpponents, for the same
 * reason (no existing cross-user aggregate-query precedent in this
 * codebase, and this app's real scale doesn't need one yet).
 */
export async function nearbyMapUsers(userId, limit = 40) {
  const me = await mapEntryFor(userId);

  const candidates = await db
    .select({ userId: playerState.userId })
    .from(playerState)
    .where(ne(playerState.userId, userId))
    .limit(80);

  const withStats = await Promise.all(candidates.map((c) => mapEntryFor(c.userId)));
  const nearby = withStats
    .filter((c) => Math.abs(c.avgMastery - me.avgMastery) <= MASTERY_BAND)
    .sort((a, b) => Math.abs(a.avgMastery - me.avgMastery) - Math.abs(b.avgMastery - me.avgMastery))
    .slice(0, limit);

  return { me, nearby };
}
