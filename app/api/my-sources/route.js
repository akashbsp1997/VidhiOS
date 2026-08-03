export const maxDuration = 30;

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { personalSources } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { createAdminClient } from "../../../lib/supabase/adminClient.js";

const BUCKET = "personal-sources";

// Lists the signed-in student's own uploaded material -- always scoped to
// their own userId, optionally narrowed to one subtopic (the common case:
// PlantDetailSheet showing what's already uploaded for the plant it's
// open on). Never takes a userId from the request; always the session's.
export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const subtopicId = searchParams.get("subtopicId");

  const where = subtopicId ? and(eq(personalSources.userId, userId), eq(personalSources.subtopicId, subtopicId)) : eq(personalSources.userId, userId);

  const rows = await db
    .select({
      id: personalSources.id,
      subtopicId: personalSources.subtopicId,
      title: personalSources.title,
      status: personalSources.status,
      pageCount: personalSources.pageCount,
      addedAt: personalSources.addedAt,
    })
    .from(personalSources)
    .where(where);

  return NextResponse.json({ sources: rows });
}

// Lets a student remove a mistaken upload -- ownership re-checked against
// the session's own userId (not just "an id was supplied"), same as every
// other per-user delete in this app.
export async function DELETE(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const [row] = await db.select().from(personalSources).where(and(eq(personalSources.id, id), eq(personalSources.userId, userId)));
  if (!row) return NextResponse.json({ error: "Not found (or not yours)." }, { status: 404 });

  const admin = createAdminClient();
  await admin.storage.from(BUCKET).remove([row.storagePath]);
  await db.delete(personalSources).where(and(eq(personalSources.id, id), eq(personalSources.userId, userId)));

  return NextResponse.json({ status: "ok" });
}
