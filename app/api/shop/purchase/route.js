export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { purchaseUnlock } from "../../../../lib/gamification/shop.js";

// POST { subtopicId } -> charges the CURRENT quoted price (re-quoted
// server-side, never trusted from the client) and grants the same
// time-bounded unlock override the free unlock_pass item does.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { subtopicId } = await request.json();
    if (!subtopicId) return NextResponse.json({ error: "subtopicId is required" }, { status: 400 });
    const result = await purchaseUnlock(userId, subtopicId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
