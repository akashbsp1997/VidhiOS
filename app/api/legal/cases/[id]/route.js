// app/api/legal/cases/[id]/route.js
// GET -> case + parties + events + drafts (the case detail hub's one-shot
// load). PATCH -> update case fields. DELETE -> remove the case and its
// dependent rows (parties/events/drafts/draft versions); documents are
// detached, not deleted, since the underlying file may still matter to the
// user on its own.
import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../../../../../lib/db.js";
import { legalCases, legalParties, legalCaseEvents, legalDrafts, legalDraftVersions, legalDocuments, legalForums } from "../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../lib/supabase/server.js";
import { LEGAL_CASE_TYPES, LEGAL_CASE_STATUSES, isValid } from "../../../../../lib/legal/docTypes.js";

async function loadOwnedCase(id, userId) {
  const [row] = await db.select().from(legalCases).where(eq(legalCases.id, id));
  if (!row || row.userId !== userId) return null;
  return row;
}

export async function GET(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const caseRow = await loadOwnedCase(id, userId);
    if (!caseRow) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const [forum] = caseRow.forumId ? await db.select().from(legalForums).where(eq(legalForums.id, caseRow.forumId)) : [null];
    const parties = await db.select().from(legalParties).where(eq(legalParties.caseId, id)).orderBy(asc(legalParties.createdAt));
    const events = await db.select().from(legalCaseEvents).where(eq(legalCaseEvents.caseId, id)).orderBy(asc(legalCaseEvents.eventDate));
    const drafts = await db.select().from(legalDrafts).where(eq(legalDrafts.caseId, id)).orderBy(asc(legalDrafts.createdAt));
    const documents = await db.select().from(legalDocuments).where(eq(legalDocuments.caseId, id)).orderBy(asc(legalDocuments.createdAt));

    return NextResponse.json({ case: caseRow, forum: forum || null, parties, events, drafts, documents });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const PATCHABLE_FIELDS = [
  "title",
  "caseNumber",
  "caseType",
  "status",
  "forumId",
  "courtName",
  "jurisdictionState",
  "causeOfAction",
  "subjectMatter",
  "claimAmount",
  "filingDate",
  "description",
];

export async function PATCH(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const caseRow = await loadOwnedCase(id, userId);
    if (!caseRow) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const body = await request.json();
    if ("caseType" in body && !isValid(LEGAL_CASE_TYPES, body.caseType)) {
      return NextResponse.json({ error: "Invalid caseType." }, { status: 400 });
    }
    if ("status" in body && !LEGAL_CASE_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    const set = { updatedAt: new Date() };
    for (const field of PATCHABLE_FIELDS) {
      if (field in body) set[field] = field === "filingDate" ? (body[field] ? new Date(body[field]) : null) : body[field];
    }
    if ("forumId" in body) set.forumId = body.forumId ? Number(body.forumId) : null;

    const [updated] = await db.update(legalCases).set(set).where(eq(legalCases.id, id)).returning();
    return NextResponse.json({ case: updated });
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
    const caseRow = await loadOwnedCase(id, userId);
    if (!caseRow) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const draftRows = await db.select({ id: legalDrafts.id }).from(legalDrafts).where(eq(legalDrafts.caseId, id));
    const draftIds = draftRows.map((d) => d.id);
    if (draftIds.length) await db.delete(legalDraftVersions).where(inArray(legalDraftVersions.draftId, draftIds));
    await db.delete(legalDrafts).where(eq(legalDrafts.caseId, id));
    await db.delete(legalCaseEvents).where(eq(legalCaseEvents.caseId, id));
    await db.delete(legalParties).where(eq(legalParties.caseId, id));
    await db.update(legalDocuments).set({ caseId: null }).where(eq(legalDocuments.caseId, id));
    await db.delete(legalCases).where(eq(legalCases.id, id));

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
