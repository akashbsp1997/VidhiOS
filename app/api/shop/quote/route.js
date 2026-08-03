export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { priceForUnlock, currentSeeds } from "../../../../lib/gamification/shop.js";

// GET ?subtopicId= -> the current dynamic price to unlock this subtopic
// early, plus the buyer's current seed balance. Re-quoted fresh every call
// -- never cached, since it depends on live mastery state.
export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const subtopicId = searchParams.get("subtopicId");
  if (!subtopicId) return NextResponse.json({ error: "subtopicId is required" }, { status: 400 });

  try {
    const [quote, seeds] = await Promise.all([priceForUnlock(userId, subtopicId), currentSeeds(userId)]);
    return NextResponse.json({ quote, seeds });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
