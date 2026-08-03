// app/api/legal/events/route.js
// GET -> every upcoming date across all of this user's cases, soonest
// first, with the case title joined in -- feeds the /legal dashboard's
// "Upcoming dates" panel so a user sees everything due without opening
// each case individually.
import { NextResponse } from "next/server";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { legalCaseEvents, legalCases } from "../../../../db/schema.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const includePast = searchParams.get("includePast") === "1";

  try {
    const conditions = [eq(legalCases.userId, userId), eq(legalCaseEvents.status, "upcoming")];
    if (!includePast) conditions.push(gte(legalCaseEvents.eventDate, new Date(new Date().setHours(0, 0, 0, 0))));

    const rows = await db
      .select({
        id: legalCaseEvents.id,
        caseId: legalCaseEvents.caseId,
        caseTitle: legalCases.title,
        eventType: legalCaseEvents.eventType,
        title: legalCaseEvents.title,
        eventDate: legalCaseEvents.eventDate,
        description: legalCaseEvents.description,
        status: legalCaseEvents.status,
      })
      .from(legalCaseEvents)
      .innerJoin(legalCases, eq(legalCaseEvents.caseId, legalCases.id))
      .where(and(...conditions))
      .orderBy(asc(legalCaseEvents.eventDate));

    return NextResponse.json({ events: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
