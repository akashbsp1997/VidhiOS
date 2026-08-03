export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { joinAlliance } from "../../../../lib/gamification/alliances.js";

// POST { allianceId } -> joins an existing alliance (open membership, no approval step).
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { allianceId } = await request.json();
    if (!allianceId) return NextResponse.json({ error: "allianceId is required" }, { status: 400 });
    const alliance = await joinAlliance(userId, allianceId);
    return NextResponse.json({ alliance });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
