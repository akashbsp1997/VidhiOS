// app/api/player/track/route.js
//
// POST { track } -> self-select a new onboarding track (one of
// db/seed/placementQuiz.js's TRACKS), overriding the one the mandatory
// placement quiz originally assigned. Gated on xp clearing
// TRACK_SWITCH_XP_THRESHOLD (lib/gamification/missions.js) -- reuses the
// existing gamification xp field as the unlock gate rather than a separate
// currency. Read side (current track/xp) is already covered by the existing
// GET /api/missions (returns the full playerState row), no new GET needed
// here.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { playerState } from "../../../../db/schema.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { loadPlayerState, TRACK_SWITCH_XP_THRESHOLD } from "../../../../lib/gamification/missions.js";
import { TRACKS } from "../../../../db/seed/placementQuiz.js";

export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { track } = await request.json();
    if (!TRACKS.includes(track)) {
      return NextResponse.json({ error: `track must be one of: ${TRACKS.join(", ")}` }, { status: 400 });
    }

    const current = await loadPlayerState(userId);
    if (current.xp < TRACK_SWITCH_XP_THRESHOLD) {
      return NextResponse.json(
        { error: `Track switching unlocks at ${TRACK_SWITCH_XP_THRESHOLD} XP -- you have ${current.xp}.` },
        { status: 403 }
      );
    }

    await db.update(playerState).set({ track, trackSetAt: new Date() }).where(eq(playerState.userId, userId));
    return NextResponse.json({ ok: true, track });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
