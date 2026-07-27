// app/api/legal/cases/route.js
// GET -> this user's cases, newest first. POST -> create a case (manually,
// or pre-filled from a reviewed document's extractedData).
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { legalCases, legalDocuments } from "../../../../db/schema.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { LEGAL_CASE_TYPES, isValid } from "../../../../lib/legal/docTypes.js";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const rows = await db.select().from(legalCases).where(eq(legalCases.userId, userId)).orderBy(desc(legalCases.updatedAt));
    return NextResponse.json({ cases: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
    const caseType = isValid(LEGAL_CASE_TYPES, body.caseType) ? body.caseType : "other";

    // sourceDocumentId, if given, must be a document this user actually
    // owns -- checked here rather than left to the FK-less integer column
    // (see db/schema.js's comment on why it's not a real FK) so a case can
    // never be created pointing at someone else's upload.
    let sourceDocumentId = null;
    if (body.sourceDocumentId) {
      const [doc] = await db
        .select({ id: legalDocuments.id, userId: legalDocuments.userId })
        .from(legalDocuments)
        .where(eq(legalDocuments.id, Number(body.sourceDocumentId)));
      if (doc && doc.userId === userId) sourceDocumentId = doc.id;
    }

    const [row] = await db
      .insert(legalCases)
      .values({
        userId,
        title,
        caseType,
        caseNumber: body.caseNumber || null,
        courtName: body.courtName || null,
        jurisdictionState: body.jurisdictionState || null,
        causeOfAction: body.causeOfAction || null,
        subjectMatter: body.subjectMatter || null,
        claimAmount: Number.isFinite(body.claimAmount) ? body.claimAmount : null,
        filingDate: body.filingDate ? new Date(body.filingDate) : null,
        description: body.description || "",
        sourceDocumentId,
      })
      .returning();

    // If created from a document, attach that document to the new case so
    // it shows up under the case's own Documents tab immediately.
    if (sourceDocumentId) {
      await db.update(legalDocuments).set({ caseId: row.id }).where(eq(legalDocuments.id, sourceDocumentId));
    }

    return NextResponse.json({ case: row });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
