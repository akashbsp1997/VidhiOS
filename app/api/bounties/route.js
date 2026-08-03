export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { todaysBounties } from "../../../lib/gamification/bounties.js";

// GET -> today's real plan-assigned topics with their 4-step bounty status
// (teach / current affairs / notes / prelims), for the World Map's bounty
// overlay.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const bounties = await todaysBounties(userId);
  return NextResponse.json({ bounties });
}
