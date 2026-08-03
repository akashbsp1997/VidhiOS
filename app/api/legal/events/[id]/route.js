// app/api/legal/events/[id]/route.js
// PATCH -> edit a date/mark it completed/adjourned/missed. DELETE -> remove it.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../../lib/db.js";
import { legalCaseEvents, legalCases } from "../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { LEGAL_EVENT_TYPES, LEGAL_EVENT_STATUSES, isValid } from "../../../../../lib/legal/docTypes.js";

async function loadOwnedEvent(id, userId) {
  const [row] = await db
    .select({ event: legalCaseEvents, caseUserId: legalCases.userId })
    .from(legalCaseEvents)
    .innerJoin(legalCases, eq(legalCaseEvents.caseId, legalCases.id))
    .where(eq(legalCaseEvents.id, id));
  if (!row || row.caseUserId !== userId) return null;
  return row.event;
}

export async function PATCH(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const event = await loadOwnedEvent(id, userId);
    if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    const body = await request.json();
    if ("eventType" in body && !isValid(LEGAL_EVENT_TYPES, body.eventType)) return NextResponse.json({ error: "Invalid eventType." }, { status: 400 });
    if ("status" in body && !LEGAL_EVENT_STATUSES.includes(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });

    const set = {};
    for (const field of ["title", "eventType", "description", "status"]) {
      if (field in body) set[field] = body[field];
    }
    if ("eventDate" in body) {
      if (Number.isNaN(new Date(body.eventDate).getTime())) return NextResponse.json({ error: "Invalid eventDate." }, { status: 400 });
      set.eventDate = new Date(body.eventDate);
    }

    const [updated] = await db.update(legalCaseEvents).set(set).where(eq(legalCaseEvents.id, id)).returning();
    return NextResponse.json({ event: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const event = await loadOwnedEvent(id, userId);
    if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    await db.delete(legalCaseEvents).where(eq(legalCaseEvents.id, id));
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
