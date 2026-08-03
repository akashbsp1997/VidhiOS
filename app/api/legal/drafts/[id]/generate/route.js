export const maxDuration = 60;

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../../../lib/db.js";
import { legalDrafts, legalCases, legalParties, legalForums, legalDraftVersions } from "../../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../../lib/supabase/server.js";
import { generateDraftContent } from "../../../../../../lib/legal/generateDraft.js";

// POST { instructions? } -> (re)generates this draft's content with AI,
// grounded in the case's own stored facts. First call on an empty draft is
// "generate"; a later call with existingContent present is "update" (see
// lib/legal/generateDraft.js) -- same route either way, the draft's own
// current content decides which mode it is. Always versions the outgoing
// content first, same as a hand-edit via PATCH /api/legal/drafts/[id].
export async function POST(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const [row] = await db
      .select({ draft: legalDrafts, caseRow: legalCases })
      .from(legalDrafts)
      .innerJoin(legalCases, eq(legalDrafts.caseId, legalCases.id))
      .where(eq(legalDrafts.id, id));
    if (!row || row.caseRow.userId !== userId) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    const { draft, caseRow } = row;

    const { instructions } = await request.json().catch(() => ({}));

    const parties = await db.select().from(legalParties).where(eq(legalParties.caseId, caseRow.id));
    const [forum] = caseRow.forumId ? await db.select({ name: legalForums.name }).from(legalForums).where(eq(legalForums.id, caseRow.forumId)) : [null];
    const forumLabel = caseRow.courtName || forum?.name || null;

    const { title, content } = await generateDraftContent({
      draftType: draft.draftType,
      caseFacts: {
        caseSummary: [caseRow.description, caseRow.causeOfAction].filter(Boolean).join(" "),
        parties,
        forumLabel,
        caseNumber: caseRow.caseNumber,
      },
      instructions,
      existingContent: draft.content || null,
    });

    if (!content) return NextResponse.json({ error: "The model returned an empty draft -- try again, or add more case detail first." }, { status: 502 });

    if (draft.content) {
      await db.insert(legalDraftVersions).values({
        draftId: id,
        versionNumber: draft.currentVersion,
        content: draft.content,
        editSummary: instructions ? `AI update: ${instructions}`.slice(0, 500) : "AI regeneration",
      });
    }

    const [updated] = await db
      .update(legalDrafts)
      .set({
        content,
        title: draft.content ? draft.title : title, // keep the user's own title once set; only adopt the AI title on the very first generation
        currentVersion: draft.content ? draft.currentVersion + 1 : draft.currentVersion,
        generatedByAi: true,
        updatedAt: new Date(),
      })
      .where(eq(legalDrafts.id, id))
      .returning();

    return NextResponse.json({ draft: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
