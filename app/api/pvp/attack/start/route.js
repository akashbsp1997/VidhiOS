export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { startAttack } from "../../../../../lib/gamification/pvp.js";

// POST { defenderUserId } -> validates eligibility (comparable mastery,
// not shielded, has a defense set) and returns the defender's current
// question set WITHOUT correctIndex.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { defenderUserId } = await request.json();
    if (!defenderUserId) return NextResponse.json({ error: "defenderUserId is required" }, { status: 400 });
    const result = await startAttack(userId, defenderUserId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
