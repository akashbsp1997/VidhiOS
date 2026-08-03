// app/api/legal/cases/[id]/forum-recommend/route.js
// GET -> ranked forum recommendations for this case (see
// lib/legal/forumRecommend.js -- deterministic/rule-based, not an AI call).
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "../../../../../../lib/db.js";
import { legalCases, legalForums } from "../../../../../../db/schema.js";
import { getSessionUserId } from "../../../../../../lib/supabase/server.js";
import { recommendForums } from "../../../../../../lib/legal/forumRecommend.js";

export async function GET(request, { params }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = Number((await params).id);
  try {
    const [caseRow] = await db.select().from(legalCases).where(eq(legalCases.id, id));
    if (!caseRow || caseRow.userId !== userId) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const forums = await db.select().from(legalForums);
    const ranked = recommendForums(
      { caseType: caseRow.caseType, subjectMatter: caseRow.subjectMatter, claimAmount: caseRow.claimAmount },
      forums
    );

    return NextResponse.json({ recommendations: ranked });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
