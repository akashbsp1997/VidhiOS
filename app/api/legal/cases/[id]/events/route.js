// app/api/legal/cases/[id]/events/route.js
// POST -> add a hearing/deadline/other date to a case ("tracking case dates").
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../../../lib/db.js";
import { legalCases, legalCaseEvents } from "../../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../../lib/supabase/server.js";
import { LEGAL_EVENT_TYPES, isValid } from "../../../../../../lib/legal/docTypes.js";

export async function POST(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const caseId = Number((await params).id);
  try {
    const [caseRow] = await db.select({ userId: legalCases.userId }).from(legalCases).where(eq(legalCases.id, caseId));
    if (!caseRow || caseRow.userId !== userId) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
    if (!isValid(LEGAL_EVENT_TYPES, body.eventType)) return NextResponse.json({ error: "Invalid eventType." }, { status: 400 });
    if (!body.eventDate || Number.isNaN(new Date(body.eventDate).getTime())) {
      return NextResponse.json({ error: "A valid eventDate is required." }, { status: 400 });
    }

    const [row] = await db
      .insert(legalCaseEvents)
      .values({
        caseId,
        eventType: body.eventType,
        title,
        eventDate: new Date(body.eventDate),
        description: body.description || "",
      })
      .returning();

    return NextResponse.json({ event: row });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
