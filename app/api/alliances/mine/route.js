export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { myAlliance } from "../../../../lib/gamification/alliances.js";

// GET -> the caller's own alliance with full member roster + stats, or { alliance: null }.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const alliance = await myAlliance(userId);
  return NextResponse.json({ alliance });
}
