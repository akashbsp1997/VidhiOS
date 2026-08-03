export const maxDuration = 60;

import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/adminClient.js";

const BUCKETS = [
  { name: "ingest-uploads", fileSizeLimit: "50MB", allowedMimeTypes: ["application/pdf"] },
  // Legal Case Manager's document uploads (app/api/legal/documents/*) --
  // images as well as PDFs, since most real uploads here are phone photos
  // of physical documents, not born-digital PDFs.
  {
    name: "legal-documents",
    fileSizeLimit: "25MB",
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"],
  },
];

// One-time (but safe to re-run) Storage setup: creates the private buckets
// uploaded files live in permanently. Nested under /api/setup/ so it's
// covered by middleware.js's existing PUBLIC_API_PREFIXES entry for
// "/api/setup" -- no middleware change needed for this route specifically
// (app/api/ingest/*, app/api/legal/* routes do need one, since they don't
// share that path prefix).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!process.env.SETUP_SECRET || key !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Missing or wrong ?key=. Check SETUP_SECRET in your Vercel env vars." }, { status: 401 });
  }

  const log = [];
  let hadError = false;
  const admin = createAdminClient();

  for (const bucket of BUCKETS) {
    try {
      const { error } = await admin.storage.createBucket(bucket.name, {
        public: false,
        fileSizeLimit: bucket.fileSizeLimit,
        allowedMimeTypes: bucket.allowedMimeTypes,
      });
      if (error) {
        // Supabase returns this specific message when the bucket is already
        // there -- idempotent re-runs should report OK, not FAIL.
        if (/already exists/i.test(error.message)) {
          log.push(`OK  bucket:${bucket.name} (already exists)`);
        } else {
          throw error;
        }
      } else {
        log.push(`OK  bucket:${bucket.name} (created)`);
      }
    } catch (err) {
      hadError = true;
      log.push(`FAIL bucket:${bucket.name} -- ${err.message}`);
    }
  }

  return NextResponse.json(
    {
      status: hadError ? "partial" : "ok",
      log,
      next: hadError
        ? "Bucket creation failed -- check SUPABASE_SERVICE_ROLE_KEY is set correctly in Vercel env vars, then re-run this URL."
        : "Storage bucket ready. Next: run /api/migrate?key=... to apply the ingest_uploads/ingest_items schema, then use /ingest/upload.",
    },
    { status: hadError ? 207 : 200 }
  );
}
