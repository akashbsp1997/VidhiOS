// app/api/legal/parties/[id]/route.js
// PATCH -> edit a party. DELETE -> remove a party. Ownership is checked
// transitively through the party's caseId -> legalCases.userId.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../../lib/db.js";
import { legalParties, legalCases } from "../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { LEGAL_PARTY_ROLES, LEGAL_PARTY_TYPES, isValid } from "../../../../../lib/legal/docTypes.js";

async function loadOwnedParty(id, userId) {
  const [row] = await db
    .select({ party: legalParties, caseUserId: legalCases.userId })
    .from(legalParties)
    .innerJoin(legalCases, eq(legalParties.caseId, legalCases.id))
    .where(eq(legalParties.id, id));
  if (!row || row.caseUserId !== userId) return null;
  return row.party;
}

export async function PATCH(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const party = await loadOwnedParty(id, userId);
    if (!party) return NextResponse.json({ error: "Party not found." }, { status: 404 });

    const body = await request.json();
    if ("role" in body && !isValid(LEGAL_PARTY_ROLES, body.role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    if ("partyType" in body && !LEGAL_PARTY_TYPES.includes(body.partyType)) return NextResponse.json({ error: "Invalid partyType." }, { status: 400 });

    const set = {};
    for (const field of ["name", "role", "partyType", "contactInfo", "advocateName", "notes"]) {
      if (field in body) set[field] = body[field];
    }

    const [updated] = await db.update(legalParties).set(set).where(eq(legalParties.id, id)).returning();
    return NextResponse.json({ party: updated });
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
    const party = await loadOwnedParty(id, userId);
    if (!party) return NextResponse.json({ error: "Party not found." }, { status: 404 });

    await db.delete(legalParties).where(eq(legalParties.id, id));
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
