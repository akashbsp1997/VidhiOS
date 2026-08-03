// app/api/subtopic-notes/route.js
//
// Personal, self-declared notes + status per (user, subtopic) -- see
// db/schema.js's mastery.notes/selfStatus comment for why this is kept
// deliberately separate from the AI-graded mastery/stage/moduleProgress on
// the same row: nothing here is read by the adaptive engine or the
// mastery-gating logic, it's purely a personal tracking layer.
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { mastery } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { markNotesDone } from "../../../lib/gamification/bounties.js";

const VALID_STATUSES = ["not-started", "in-progress", "done"];

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const subtopicId = searchParams.get("subtopicId");
  if (!subtopicId) return NextResponse.json({ error: "subtopicId is required" }, { status: 400 });

  try {
    const rows = await db
      .select({ notes: mastery.notes, selfStatus: mastery.selfStatus })
      .from(mastery)
      .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    const row = rows[0];
    return NextResponse.json({ subtopicId, notes: row?.notes ?? "", selfStatus: row?.selfStatus ?? "not-started" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Accepts a partial update -- { subtopicId, notes } or { subtopicId,
// selfStatus } or both -- so the notes textarea's debounced autosave and the
// status buttons' immediate save don't clobber each other's field.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { subtopicId, notes, selfStatus } = await request.json();
    if (!subtopicId) return NextResponse.json({ error: "subtopicId is required" }, { status: 400 });
    if (selfStatus !== undefined && !VALID_STATUSES.includes(selfStatus)) {
      return NextResponse.json({ error: `selfStatus must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
    }

    const existingRows = await db.select().from(mastery).where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    const existing = existingRows[0];
    const nextNotes = notes !== undefined ? notes : (existing?.notes ?? "");
    const nextStatus = selfStatus !== undefined ? selfStatus : (existing?.selfStatus ?? "not-started");

    if (existing) {
      await db
        .update(mastery)
        .set({ notes: nextNotes, selfStatus: nextStatus })
        .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    } else {
      await db.insert(mastery).values({ userId, subtopicId, notes: nextNotes, selfStatus: nextStatus });
    }

    // Daily Bounty (lib/gamification/bounties.js) -- a real, non-empty note
    // is what counts as "notemaking done," not just any POST to this route
    // (a bare selfStatus update shouldn't count).
    if (nextNotes.trim()) await markNotesDone(userId, subtopicId);

    return NextResponse.json({ subtopicId, notes: nextNotes, selfStatus: nextStatus });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
