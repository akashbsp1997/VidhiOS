export const maxDuration = 60;

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../../lib/db.js";
import { legalDocuments } from "../../../../../db/schema.js";
import { createAdminClient } from "../../../../../lib/supabase/adminClient.js";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { hashBuffer } from "../../../../../lib/ingest/extractPdf.js"; // sha256 helper -- generic, not PDF-specific despite the file name
import { extractLegalDocument } from "../../../../../lib/legal/extractDocument.js";
import { LEGAL_DOCUMENT_MIME_TYPES, LEGAL_DOCUMENT_TYPES, isValid } from "../../../../../lib/legal/docTypes.js";

const BUCKET = "legal-documents";
// Gemini's inline (non-File-API) request body has real practical size limits
// once base64-encoded (~1.33x the raw bytes) -- capped well under the
// bucket's own 25MB upload limit so a still-too-large file fails with a
// clear message here rather than an opaque 413/timeout from the AI call.
const MAX_EXTRACT_BYTES = 15 * 1024 * 1024;

// Step 3 of the upload flow (after the browser has already PUT the bytes
// straight to Storage via the signed URL from upload-url -- see that
// route's header comment): downloads the object back to hash it (dedupe)
// and run OCR+structuring in one Gemini vision call
// (lib/legal/extractDocument.js), then inserts the legalDocuments row.
// Extraction failure is NOT fatal to the upload -- the row is still
// created with status "error" so the file itself is never lost, only the
// AI-suggested fields; the user can retry extraction later.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { storagePath, originalFilename, fileMimeType, fileSizeBytes, docType, caseId } = await request.json();
    if (!storagePath || !originalFilename || !LEGAL_DOCUMENT_MIME_TYPES.includes(fileMimeType)) {
      return NextResponse.json({ error: "storagePath, originalFilename, and a valid fileMimeType are required" }, { status: 400 });
    }
    // storagePath is namespaced "<userId>/..." by upload-url -- reject a
    // path under a different user's prefix outright rather than trusting
    // the client-supplied value.
    if (!storagePath.startsWith(`${userId}/`)) {
      return NextResponse.json({ error: "storagePath does not belong to the current user." }, { status: 403 });
    }
    const resolvedDocType = isValid(LEGAL_DOCUMENT_TYPES, docType) ? docType : "other";

    const admin = createAdminClient();
    const { data: fileBlob, error: downloadError } = await admin.storage.from(BUCKET).download(storagePath);
    if (downloadError) {
      return NextResponse.json(
        { error: `Could not find the uploaded object at "${storagePath}" -- upload may not have completed: ${downloadError.message}` },
        { status: 400 }
      );
    }
    const buf = Buffer.from(await fileBlob.arrayBuffer());
    const contentHash = hashBuffer(buf);

    const [existing] = await db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(and(eq(legalDocuments.userId, userId), eq(legalDocuments.contentHash, contentHash)));
    if (existing) {
      return NextResponse.json({ status: "duplicate", documentId: existing.id });
    }

    const [row] = await db
      .insert(legalDocuments)
      .values({
        userId,
        caseId: caseId ? Number(caseId) : null,
        docType: resolvedDocType,
        storagePath,
        originalFilename,
        fileMimeType,
        fileSizeBytes: fileSizeBytes || buf.length,
        contentHash,
        status: "uploaded",
      })
      .returning();

    if (buf.length > MAX_EXTRACT_BYTES) {
      await db
        .update(legalDocuments)
        .set({ status: "error", errorMsg: `File is too large to extract automatically (${Math.round(buf.length / 1024 / 1024)}MB, limit ${MAX_EXTRACT_BYTES / 1024 / 1024}MB). The file itself was still saved.` })
        .where(eq(legalDocuments.id, row.id));
      return NextResponse.json({ status: "error", documentId: row.id, error: "File too large to extract automatically -- saved without extraction." });
    }

    try {
      const extracted = await extractLegalDocument({ mimeType: fileMimeType, base64: buf.toString("base64") });
      const { fullText, ...extractedData } = extracted;
      await db
        .update(legalDocuments)
        .set({ status: "extracted", extractedText: fullText, extractedData, extractedAt: new Date(), errorMsg: null })
        .where(eq(legalDocuments.id, row.id));
      return NextResponse.json({ status: "extracted", documentId: row.id, extractedData });
    } catch (extractErr) {
      console.error(extractErr);
      await db
        .update(legalDocuments)
        .set({ status: "error", errorMsg: String(extractErr.message).slice(0, 500) })
        .where(eq(legalDocuments.id, row.id));
      return NextResponse.json({ status: "error", documentId: row.id, error: `Upload saved, but extraction failed: ${extractErr.message}` });
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
