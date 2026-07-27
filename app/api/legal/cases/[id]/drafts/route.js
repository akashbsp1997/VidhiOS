// app/api/legal/cases/[id]/drafts/route.js
// POST -> create a new (initially empty) draft slot for a case. Content is
// filled in either by hand (PATCH /api/legal/drafts/[id]) or by AI
// (POST /api/legal/drafts/[id]/generate).
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../../../lib/db.js";
import { legalCases, legalDrafts } from "../../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../../lib/supabase/server.js";
import { LEGAL_DRAFT_TYPES, isValid } from "../../../../../../lib/legal/docTypes.js";

export async function POST(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const caseId = Number((await params).id);
  try {
    const [caseRow] = await db.select({ userId: legalCases.userId }).from(legalCases).where(eq(legalCases.id, caseId));
    if (!caseRow || caseRow.userId !== userId) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const body = await request.json();
    if (!isValid(LEGAL_DRAFT_TYPES, body.draftType)) return NextResponse.json({ error: "Invalid draftType." }, { status: 400 });
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : LEGAL_DRAFT_TYPES.find((t) => t.value === body.draftType)?.label || "Draft";

    const [row] = await db.insert(legalDrafts).values({ caseId, draftType: body.draftType, title }).returning();
    return NextResponse.json({ draft: row });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
