// lib/ingest/fetchUrlUpload.js
//
// Shared by app/api/ingest/fetch-url (one URL, operator-submitted from the
// Ingest Upload UI) and app/api/setup/backfill-source-library (many URLs,
// from the curated list in lib/ingest/sourceLibrary.js) -- both need the
// identical fetch-archive-extract sequence: download the PDF server-side,
// archive it into the private 'ingest-uploads' Storage bucket (so it's
// still backed up even if the source URL later goes away), then hand off
// to lib/ingest/finalizeUpload.js's shared hash/dedupe/extract/insert step.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createAdminClient } from "../supabase/adminClient.js";
import { isValidDocType } from "./docTypes.js";
import { finalizeIngestUpload } from "./finalizeUpload.js";
import { USER_AGENT, looksLikePdf } from "../sources/fetchAndCache.js";
import { db } from "../db.js";
import { subjects } from "../../db/schema.js";

const BUCKET = "ingest-uploads";

export class FetchUrlUploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function fetchUrlToIngestUpload({ docType, subjectId, url }) {
  if (!isValidDocType(docType) || !subjectId || !url) {
    throw new FetchUrlUploadError("docType, subjectId, url are required");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("not http(s)");
  } catch {
    throw new FetchUrlUploadError(`"${url}" is not a valid http(s) URL.`);
  }
  const [subject] = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId));
  if (!subject) throw new FetchUrlUploadError(`Unknown subjectId "${subjectId}"`);

  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    throw new FetchUrlUploadError(`Could not reach "${url}": ${err.message}`);
  }
  if (!res.ok) {
    throw new FetchUrlUploadError(`Fetching "${url}" returned ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!looksLikePdf(url, contentType)) {
    throw new FetchUrlUploadError(
      `"${url}" doesn't look like a PDF (content-type: "${contentType}") -- this pipeline only handles PDFs for now.`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());

  const originalFilename = decodeURIComponent(parsedUrl.pathname.split("/").pop() || "document.pdf");
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const storagePath = `${docType}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, buf, { contentType: "application/pdf" });
  if (uploadError) throw new FetchUrlUploadError(uploadError.message, 500);

  return finalizeIngestUpload({
    buf,
    docType,
    subjectId,
    storagePath,
    originalFilename,
    fileSizeBytes: buf.length,
    sourceUrl: url,
  });
}
