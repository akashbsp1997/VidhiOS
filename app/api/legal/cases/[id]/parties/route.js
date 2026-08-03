// app/api/legal/cases/[id]/parties/route.js
// POST -> add a party to a case (the "party selection" surface).
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../../../lib/db.js";
import { legalCases, legalParties } from "../../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../../lib/supabase/server.js";
import { LEGAL_PARTY_ROLES, LEGAL_PARTY_TYPES, isValid } from "../../../../../../lib/legal/docTypes.js";

export async function POST(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const caseId = Number((await params).id);
  try {
    const [caseRow] = await db.select({ userId: legalCases.userId }).from(legalCases).where(eq(legalCases.id, caseId));
    if (!caseRow || caseRow.userId !== userId) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!isValid(LEGAL_PARTY_ROLES, body.role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });

    const [row] = await db
      .insert(legalParties)
      .values({
        caseId,
        name,
        role: body.role,
        partyType: LEGAL_PARTY_TYPES.includes(body.partyType) ? body.partyType : "individual",
        contactInfo: body.contactInfo && typeof body.contactInfo === "object" ? body.contactInfo : {},
        advocateName: body.advocateName || null,
        notes: body.notes || "",
      })
      .returning();

    return NextResponse.json({ party: row });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
