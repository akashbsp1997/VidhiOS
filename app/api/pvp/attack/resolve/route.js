export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { resolveAttack } from "../../../../../lib/gamification/pvp.js";

// POST { defenderUserId, answers: number[] } -> re-validates eligibility,
// grades against the defender's CURRENT question set (never the client's
// echo), resolves win/loss/tie, moves seeds and shields the defender only
// on a clear attacker win. Always resolves immediately -- see
// lib/gamification/pvp.js's header comment for why there's no
// "waiting on the other player" state.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { defenderUserId, answers } = await request.json();
    if (!defenderUserId || !Array.isArray(answers)) {
      return NextResponse.json({ error: "defenderUserId and answers[] are required" }, { status: 400 });
    }
    const result = await resolveAttack(userId, defenderUserId, answers);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
