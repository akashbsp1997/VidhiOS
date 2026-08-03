export const maxDuration = 60;

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../../../lib/db.js";
import { subtopics } from "../../../../db/schema.js";
import { createAdminClient } from "../../../../lib/supabase/adminClient.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";

const BUCKET = "personal-sources";

// Step 1 of a student's own private upload flow -- mirrors
// app/api/ingest/upload-url's signed-URL pattern (browser PUTs bytes
// directly to Storage, bypassing Vercel's request-body ceiling) but
// session-gated instead of SETUP_SECRET-gated, and the storage path is
// prefixed by the authenticated user's own id, never client-supplied, so
// one student's uploads can never land under another's prefix.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { subtopicId, filename } = await request.json();
    if (!subtopicId || typeof filename !== "string" || !filename) {
      return NextResponse.json({ error: "subtopicId and filename are required" }, { status: 400 });
    }
    const [subtopic] = await db.select({ id: subtopics.id }).from(subtopics).where(eq(subtopics.id, subtopicId));
    if (!subtopic) return NextResponse.json({ error: `Unknown subtopicId "${subtopicId}"` }, { status: 400 });

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
    const storagePath = `${userId}/${subtopicId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;

    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
    if (error) throw error;

    return NextResponse.json({ storagePath, signedUrl: data.signedUrl, token: data.token });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
