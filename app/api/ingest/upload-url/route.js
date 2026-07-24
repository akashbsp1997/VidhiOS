export const maxDuration = 60;

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../../../lib/db.js";
import { subjects } from "../../../../db/schema.js";
import { createAdminClient } from "../../../../lib/supabase/adminClient.js";
import { isValidDocType, INGEST_DOC_TYPES } from "../../../../lib/ingest/docTypes.js";

const BUCKET = "ingest-uploads";

// Step 1 of the 3-step upload flow (see the Phase 2 plan): mints a
// short-lived signed Storage upload URL so the browser can PUT the raw PDF
// bytes DIRECTLY to Supabase Storage, bypassing Vercel Route Handlers'
// ~4.5MB request-body ceiling entirely -- a real NCERT chapter or PYQ
// compilation can exceed that easily. No DB row is created here; that
// happens in /api/ingest/finalize-upload, only after the bytes are
// confirmed to actually be in Storage.
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!process.env.SETUP_SECRET || key !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Missing or wrong ?key=." }, { status: 401 });
  }

  try {
    const { docType, subjectId, filename } = await request.json();
    if (!isValidDocType(docType)) {
      return NextResponse.json({ error: `docType must be one of: ${INGEST_DOC_TYPES.join(", ")}` }, { status: 400 });
    }
    if (!subjectId || typeof filename !== "string" || !filename) {
      return NextResponse.json({ error: "subjectId and filename are required" }, { status: 400 });
    }
    const [subject] = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId));
    if (!subject) {
      return NextResponse.json({ error: `Unknown subjectId "${subjectId}"` }, { status: 400 });
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
    const storagePath = `${docType}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;

    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
    if (error) throw error;

    return NextResponse.json({ storagePath, signedUrl: data.signedUrl, token: data.token });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
