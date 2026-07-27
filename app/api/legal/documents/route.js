// app/api/legal/documents/route.js
// GET ?caseId=123 (optional) -> this user's documents, newest first.
import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { legalDocuments } from "../../../../db/schema.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const caseId = searchParams.get("caseId");
  // "unassigned" is a real filter value (not just absence of the param) --
  // the upload screen uses it to show only documents not yet attached to
  // any case, so the user can pick one to attach or create a case from.
  const wantsUnassigned = caseId === "unassigned";

  try {
    const conditions = [eq(legalDocuments.userId, userId)];
    if (wantsUnassigned) conditions.push(isNull(legalDocuments.caseId));
    else if (caseId) conditions.push(eq(legalDocuments.caseId, Number(caseId)));

    const rows = await db
      .select({
        id: legalDocuments.id,
        caseId: legalDocuments.caseId,
        docType: legalDocuments.docType,
        originalFilename: legalDocuments.originalFilename,
        fileMimeType: legalDocuments.fileMimeType,
        fileSizeBytes: legalDocuments.fileSizeBytes,
        status: legalDocuments.status,
        extractedData: legalDocuments.extractedData,
        errorMsg: legalDocuments.errorMsg,
        createdAt: legalDocuments.createdAt,
        extractedAt: legalDocuments.extractedAt,
      })
      .from(legalDocuments)
      .where(and(...conditions))
      .orderBy(desc(legalDocuments.createdAt));

    return NextResponse.json({ documents: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
