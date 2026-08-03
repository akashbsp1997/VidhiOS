export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { listAlliances, createAlliance } from "../../../lib/gamification/alliances.js";

// GET -> every alliance, ranked by total mature plants (the leaderboard).
// POST { name, tag } -> creates a new alliance with the caller as leader.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const alliances = await listAlliances();
  return NextResponse.json({ alliances });
}

export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { name, tag } = await request.json();
    const alliance = await createAlliance(userId, name, tag);
    return NextResponse.json({ alliance });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
