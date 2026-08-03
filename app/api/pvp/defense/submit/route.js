export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { submitDefense } from "../../../../../lib/gamification/pvp.js";

// POST { answers: number[] } -> grades against the in-progress defense set
// from /api/pvp/defense/start and sets it as the standing benchmark.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { answers } = await request.json();
    if (!Array.isArray(answers)) return NextResponse.json({ error: "answers must be an array" }, { status: 400 });
    const result = await submitDefense(userId, answers);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
