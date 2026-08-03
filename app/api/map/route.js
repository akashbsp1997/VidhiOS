export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { nearbyMapUsers } from "../../../lib/gamification/worldMap.js";

// GET -> this user's own map entry plus nearby (comparable-mastery)
// players -- a virtual world, no real location involved. See
// lib/gamification/worldMap.js's header comment.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { me, nearby } = await nearbyMapUsers(userId);
  return NextResponse.json({ me, nearby });
}
