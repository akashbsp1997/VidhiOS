export const maxDuration = 60;

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../../lib/db.js";
import { legalDocuments, legalCases } from "../../../../../db/schema.js";
import { createAdminClient } from "../../../../../lib/supabase/adminClient.js";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { extractLegalDocument } from "../../../../../lib/legal/extractDocument.js";
import { LEGAL_DOCUMENT_TYPES, isValid } from "../../../../../lib/legal/docTypes.js";

const BUCKET = "legal-documents";
const EXPIRES_IN_SECONDS = 60 * 60;

async function loadOwnedDocument(id, userId) {
  const [doc] = await db
    .select()
    .from(legalDocuments)
    .where(and(eq(legalDocuments.id, id), eq(legalDocuments.userId, userId)));
  return doc || null;
}

// GET -> document row + a fresh signed URL to view/download the original file.
export async function GET(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const doc = await loadOwnedDocument(id, userId);
    if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(doc.storagePath, EXPIRES_IN_SECONDS);
    if (error) throw error;

    return NextResponse.json({ document: doc, url: data.signedUrl });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH { caseId?, docType?, retryExtraction? } -- attach/reassign a
// document to a case, correct its type, or re-run extraction after a
// transient failure. Only fields actually present in the body are changed.
export async function PATCH(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const doc = await loadOwnedDocument(id, userId);
    if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

    const body = await request.json();

    if (body.retryExtraction) {
      const admin = createAdminClient();
      const { data: fileBlob, error: downloadError } = await admin.storage.from(BUCKET).download(doc.storagePath);
      if (downloadError) return NextResponse.json({ error: `Could not re-download the file: ${downloadError.message}` }, { status: 500 });
      const buf = Buffer.from(await fileBlob.arrayBuffer());
      try {
        const extracted = await extractLegalDocument({ mimeType: doc.fileMimeType, base64: buf.toString("base64") });
        const { fullText, ...extractedData } = extracted;
        const [updated] = await db
          .update(legalDocuments)
          .set({ status: "extracted", extractedText: fullText, extractedData, extractedAt: new Date(), errorMsg: null })
          .where(eq(legalDocuments.id, id))
          .returning();
        return NextResponse.json({ document: updated });
      } catch (extractErr) {
        console.error(extractErr);
        const [updated] = await db
          .update(legalDocuments)
          .set({ status: "error", errorMsg: String(extractErr.message).slice(0, 500) })
          .where(eq(legalDocuments.id, id))
          .returning();
        return NextResponse.json({ document: updated, error: extractErr.message }, { status: 502 });
      }
    }

    const set = {};
    if ("caseId" in body) {
      if (body.caseId != null) {
        const [ownedCase] = await db.select({ id: legalCases.id }).from(legalCases).where(and(eq(legalCases.id, Number(body.caseId)), eq(legalCases.userId, userId)));
        if (!ownedCase) return NextResponse.json({ error: "Unknown or inaccessible caseId." }, { status: 400 });
        set.caseId = ownedCase.id;
      } else {
        set.caseId = null;
      }
    }
    if ("docType" in body) {
      if (!isValid(LEGAL_DOCUMENT_TYPES, body.docType)) return NextResponse.json({ error: "Invalid docType." }, { status: 400 });
      set.docType = body.docType;
    }

    if (Object.keys(set).length === 0) return NextResponse.json({ document: doc });

    const [updated] = await db.update(legalDocuments).set(set).where(eq(legalDocuments.id, id)).returning();
    return NextResponse.json({ document: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE -- removes the row and the backing Storage object. A document
// that's the sourceDocumentId for some case is left alone (the case's
// pointer just becomes stale/unresolvable, same as any other soft
// provenance link elsewhere in this app) rather than blocked outright.
export async function DELETE(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const doc = await loadOwnedDocument(id, userId);
    if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

    const admin = createAdminClient();
    await admin.storage.from(BUCKET).remove([doc.storagePath]);
    await db.delete(legalDocuments).where(eq(legalDocuments.id, id));

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
