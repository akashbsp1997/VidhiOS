// app/api/legal/drafts/[id]/route.js
// GET -> draft + its version history. PATCH -> save edited content (always
// appends a legalDraftVersions row for the version being REPLACED, so
// history stays reconstructible -- see db/schema.js's legalDraftVersions
// comment). DELETE -> remove the draft and its history.
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "../../../../../lib/db.js";
import { legalDrafts, legalDraftVersions, legalCases } from "../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { LEGAL_DRAFT_STATUSES } from "../../../../../lib/legal/docTypes.js";

async function loadOwnedDraft(id, userId) {
  const [row] = await db
    .select({ draft: legalDrafts, caseUserId: legalCases.userId })
    .from(legalDrafts)
    .innerJoin(legalCases, eq(legalDrafts.caseId, legalCases.id))
    .where(eq(legalDrafts.id, id));
  if (!row || row.caseUserId !== userId) return null;
  return row.draft;
}

export async function GET(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const draft = await loadOwnedDraft(id, userId);
    if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });

    const versions = await db.select().from(legalDraftVersions).where(eq(legalDraftVersions.draftId, id)).orderBy(desc(legalDraftVersions.versionNumber));
    return NextResponse.json({ draft, versions });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Saves new content over a draft's current content -- used both for a
 * hand-edit (body.content only) and after an AI generate/update call (the
 * generate route below writes through here too, so version history is
 * always created in exactly one place). Snapshots the OUTGOING content as
 * the next version row before overwriting, so version numbering stays
 * "version N is what was live before edit N+1" with no gaps.
 */
export async function PATCH(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const draft = await loadOwnedDraft(id, userId);
    if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });

    const body = await request.json();
    const set = { updatedAt: new Date() };
    if ("title" in body && typeof body.title === "string" && body.title.trim()) set.title = body.title.trim().slice(0, 200);
    if ("status" in body) {
      if (!LEGAL_DRAFT_STATUSES.includes(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
      set.status = body.status;
    }
    if ("generatedByAi" in body) set.generatedByAi = Boolean(body.generatedByAi);

    if ("content" in body && typeof body.content === "string" && body.content !== draft.content) {
      await db.insert(legalDraftVersions).values({
        draftId: id,
        versionNumber: draft.currentVersion,
        content: draft.content,
        editSummary: typeof body.editSummary === "string" ? body.editSummary.slice(0, 500) : "",
      });
      set.content = body.content;
      set.currentVersion = draft.currentVersion + 1;
    }

    const [updated] = await db.update(legalDrafts).set(set).where(eq(legalDrafts.id, id)).returning();
    return NextResponse.json({ draft: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const draft = await loadOwnedDraft(id, userId);
    if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });

    await db.delete(legalDraftVersions).where(eq(legalDraftVersions.draftId, id));
    await db.delete(legalDrafts).where(eq(legalDrafts.id, id));
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
