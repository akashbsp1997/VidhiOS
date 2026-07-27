export const maxDuration = 30;

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "../../../../../lib/supabase/adminClient.js";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { LEGAL_DOCUMENT_MIME_TYPES } from "../../../../../lib/legal/docTypes.js";

const BUCKET = "legal-documents";

// Step 1 of the 3-step upload flow (same shape as app/api/ingest/upload-url,
// see that file's header comment for why a signed direct-to-Storage PUT
// beats a Route Handler body upload): mints a short-lived signed Storage
// upload URL so the browser can PUT the raw bytes directly, bypassing
// Vercel's request-body ceiling. Session-gated (any signed-in user), not
// SETUP_SECRET-gated -- this is a normal user-facing feature, not an
// operator/admin pipeline. storagePath is namespaced under the user's own
// id so two users' filenames never collide and each user's own files stay
// visually/organizationally separated in the bucket.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { filename, mimeType } = await request.json();
    if (typeof filename !== "string" || !filename) {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }
    if (!LEGAL_DOCUMENT_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json({ error: `mimeType must be one of: ${LEGAL_DOCUMENT_MIME_TYPES.join(", ")}` }, { status: 400 });
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
    const storagePath = `${userId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;

    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
    if (error) throw error;

    return NextResponse.json({ storagePath, signedUrl: data.signedUrl, token: data.token });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
