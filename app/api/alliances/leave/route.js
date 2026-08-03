export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { leaveAlliance } from "../../../../lib/gamification/alliances.js";

// POST -> leaves the caller's current alliance. Deletes the alliance if
// they were the last member; passes leadership on if they were the leader.
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    await leaveAlliance(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
