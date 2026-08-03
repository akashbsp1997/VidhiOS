export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { loadPlayerState } from "../../../../lib/gamification/missions.js";
import { computeAvgMastery, computeMatureCount, SEEDS_WAGER, SHIELD_HOURS, DEFENSE_QUIZ_SIZE } from "../../../../lib/gamification/pvp.js";
import { estateTierForMatureCount } from "../../../../lib/forest/estate.js";

// GET -> everything the arena page's header needs in one call: estate
// tier, seeds, defense status, shield status. Read-only.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [ps, avgMastery, matureCount] = await Promise.all([loadPlayerState(userId), computeAvgMastery(userId), computeMatureCount(userId)]);
  const estateTier = estateTierForMatureCount(matureCount);
  const shielded = ps.shieldedUntil && new Date(ps.shieldedUntil) > new Date();

  return NextResponse.json({
    seeds: ps.seeds,
    estateTier,
    matureCount,
    avgMastery,
    defenseScore: ps.defenseScore,
    defenseTotal: DEFENSE_QUIZ_SIZE,
    defenseSetAt: ps.defenseSetAt,
    shielded,
    shieldedUntil: ps.shieldedUntil,
    seedsWager: SEEDS_WAGER,
    shieldHours: SHIELD_HOURS,
  });
}
