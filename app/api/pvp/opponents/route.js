export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { findOpponents } from "../../../../lib/gamification/pvp.js";
import { tagsForUsers } from "../../../../lib/gamification/alliances.js";

// GET -> candidate opponents (comparable mastery, has a defense set, not
// shielded, not self). See findOpponents' own comment for the matchmaking
// approach. Alliance tags are joined in here at the route layer, not
// inside pvp.js itself (which can't import from lib/gamification/alliances.js
// without a circular dependency -- see pvp.js's inlined sameAlliance).
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const opponents = await findOpponents(userId);
  const tags = await tagsForUsers(opponents.map((o) => o.userId));
  return NextResponse.json({ opponents: opponents.map((o) => ({ ...o, allianceTag: tags[o.userId] ?? null })) });
}
