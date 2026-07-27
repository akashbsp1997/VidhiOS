// app/api/setup/backfill-source-library/route.js
//
// One-time, manually-triggered pull of real primary-source documents into
// the Ingest pipeline -- the Constitution of India plus NCERT textbook
// chapters covering GS1/GS2/GS3 (see lib/ingest/sourceLibrary.js for the
// curated list and where each URL comes from). Reuses the exact
// fetch-archive-extract path app/api/ingest/fetch-url already uses for a
// single operator-submitted URL (lib/ingest/fetchUrlUpload.js), just looped
// over the whole list.
//
// Lands documents in ingestUploads with status "extracted"/"needs_ocr" --
// same as any other upload. Still needs the existing per-upload AI
// structuring + review step (visit /ingest/upload?key=..., "Structure all
// chunks", then review/bulk-approve) before any of this becomes a live
// grounding source; this route only handles the download/extract half.
//
// Resumable via ?cursor=, same "process a bounded slice, tell the caller
// where to continue" pattern as /api/setup/backfill-current-affairs -- a
// single call downloading and extracting all ~120 documents would run well
// past any serverless maxDuration. Re-visit with the returned `continueAt`
// URL to keep going; `done: true` means the whole list has been processed
// for this run. Each item is individually try/caught so one broken or slow
// URL never aborts the batch or loses the cursor (see the
// backfill-current-affairs fix this same session for why that matters).
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { SOURCE_LIBRARY } from "../../../../lib/ingest/sourceLibrary.js";
import { fetchUrlToIngestUpload } from "../../../../lib/ingest/fetchUrlUpload.js";

// Small batch -- each item is a real multi-MB network download plus a
// pdf-parse pass, not a cheap DB call, so this stays conservative to fit
// comfortably inside maxDuration even if an item or two is slow.
const ITEMS_PER_RUN = 5;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!process.env.SETUP_SECRET || key !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Missing or wrong ?key=. Check SETUP_SECRET in your Vercel env vars." }, { status: 401 });
  }

  const cursor = Math.max(0, Number(searchParams.get("cursor") ?? 0) || 0);
  const slice = SOURCE_LIBRARY.slice(cursor, cursor + ITEMS_PER_RUN);

  const results = [];
  for (const item of slice) {
    try {
      const result = await fetchUrlToIngestUpload({ docType: item.docType, subjectId: item.subjectId, url: item.url });
      results.push({ label: item.label, url: item.url, ...result });
    } catch (err) {
      results.push({ label: item.label, url: item.url, status: "error", error: err.message });
    }
  }

  const nextCursor = cursor + slice.length;
  const done = nextCursor >= SOURCE_LIBRARY.length;

  return NextResponse.json({
    status: "ok",
    done,
    processed: `${nextCursor}/${SOURCE_LIBRARY.length}`,
    results,
    ...(done ? {} : { continueAt: `/api/setup/backfill-source-library?key=${encodeURIComponent(key)}&cursor=${nextCursor}` }),
  });
}
