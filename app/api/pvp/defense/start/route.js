export const maxDuration = 20;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { startDefense } from "../../../../../lib/gamification/pvp.js";

// POST -> issues a fresh defense MCQ set, overwriting any previous one.
// Questions only, no correctIndex -- see startDefense's own comment.
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const questions = await startDefense(userId);
    return NextResponse.json({ questions });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
