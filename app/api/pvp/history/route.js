export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { recentBattles, anonymizedLabel } from "../../../../lib/gamification/pvp.js";

// GET -> this user's recent PvP battles (either side), newest first, with
// an anonymized label for whoever the "other side" was.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const battles = await recentBattles(userId);
  return NextResponse.json({
    battles: battles.map((b) => ({
      ...b,
      wasAttacker: b.attackerUserId === userId,
      opponentLabel: anonymizedLabel(b.attackerUserId === userId ? b.defenderUserId : b.attackerUserId),
    })),
  });
}
