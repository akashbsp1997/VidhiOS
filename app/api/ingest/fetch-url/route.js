export const maxDuration = 60;

import { NextResponse } from "next/server";
import { fetchUrlToIngestUpload, FetchUrlUploadError } from "../../../../lib/ingest/fetchUrlUpload.js";

// Alternative to the upload-url/finalize-upload pair, for content that's
// already publicly hosted (e.g. an NCERT textbook PDF) -- no reason to make
// the operator download it and re-upload it by hand. The actual
// fetch-archive-extract logic lives in lib/ingest/fetchUrlUpload.js, shared
// with app/api/setup/backfill-source-library's bulk pull of the curated
// list in lib/ingest/sourceLibrary.js.
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!process.env.SETUP_SECRET || key !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Missing or wrong ?key=." }, { status: 401 });
  }

  try {
    const { docType, subjectId, url } = await request.json();
    const result = await fetchUrlToIngestUpload({ docType, subjectId, url });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    const status = err instanceof FetchUrlUploadError ? err.status : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
