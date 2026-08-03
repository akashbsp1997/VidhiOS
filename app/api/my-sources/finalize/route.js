export const maxDuration = 60;

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { subtopics, personalSources } from "../../../../db/schema.js";
import { createAdminClient } from "../../../../lib/supabase/adminClient.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { extractPdfText } from "../../../../lib/ingest/extractPdf.js";

const BUCKET = "personal-sources";

// Step 2: called after the browser has already PUT the raw bytes to
// Storage using the signed URL from upload-url. Downloads the object back
// (needed regardless, for extraction), runs the same pdf-parse extraction
// the admin Ingest pipeline uses (lib/ingest/extractPdf.js -- already
// buffer-based and generic, no admin-only coupling), and inserts the row.
//
// No AI structuring or operator review step here, unlike the admin
// pipeline -- this is one student's own private material for their own
// private grounding, not content headed into a shared catalog other users'
// generation will read, so there's no "is this trustworthy for everyone"
// question to gate on.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { subtopicId, storagePath, title, fileSizeBytes } = await request.json();
    if (!subtopicId || !storagePath || typeof title !== "string" || !title) {
      return NextResponse.json({ error: "subtopicId, storagePath, title are required" }, { status: 400 });
    }
    // storagePath must be under this user's own prefix -- upload-url always
    // mints it that way, but finalize shouldn't blindly trust a
    // client-supplied path without checking, in case a request is replayed
    // or hand-crafted.
    if (!storagePath.startsWith(`${userId}/`)) {
      return NextResponse.json({ error: "storagePath does not belong to the signed-in user." }, { status: 403 });
    }
    const [subtopic] = await db.select({ id: subtopics.id }).from(subtopics).where(eq(subtopics.id, subtopicId));
    if (!subtopic) return NextResponse.json({ error: `Unknown subtopicId "${subtopicId}"` }, { status: 400 });

    const admin = createAdminClient();
    const { data: fileBlob, error: downloadError } = await admin.storage.from(BUCKET).download(storagePath);
    if (downloadError) {
      return NextResponse.json(
        { error: `Could not find the uploaded object at "${storagePath}" -- upload may not have completed: ${downloadError.message}` },
        { status: 400 }
      );
    }
    const buf = Buffer.from(await fileBlob.arrayBuffer());
    const { extractedText, pageCount, charsPerPage, needsOcr } = await extractPdfText(buf);

    const [row] = await db
      .insert(personalSources)
      .values({
        userId,
        subtopicId,
        title,
        storagePath,
        fileSizeBytes: fileSizeBytes || buf.length,
        pageCount,
        extractedText,
        status: needsOcr ? "needs_ocr" : "extracted",
      })
      .returning();

    return NextResponse.json({
      status: row.status,
      id: row.id,
      pageCount,
      charsPerPage: Math.round(charsPerPage),
      needsOcr,
      textPreview: extractedText.slice(0, 500),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
