export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { findOpponents } from "../../../../lib/gamification/pvp.js";

// GET -> candidate opponents (comparable mastery, has a defense set, not
// shielded, not self). See findOpponents' own comment for the matchmaking
// approach.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const opponents = await findOpponents(userId);
  return NextResponse.json({ opponents });
}
