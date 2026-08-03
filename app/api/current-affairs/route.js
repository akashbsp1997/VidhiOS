// app/api/current-affairs/route.js
//
// GET ?days=<n> -> recent current-affairs digest items (default 7 days,
// capped at 30), each with the real subtopics it's tagged against resolved
// to display text. Populated by app/api/cron/fetch-current-affairs -- this
// route is read-only and makes no AI calls.
import { NextResponse } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { currentAffairsItems, subtopics } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { currentWeekFocus } from "../../../lib/adaptive/weeklyFocus.js";

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(30, Math.max(1, Number(searchParams.get("days")) || 7));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rows = await db.select().from(currentAffairsItems).orderBy(desc(currentAffairsItems.createdAt)).limit(200);
    const recent = rows.filter((r) => r.publishedDate >= cutoff);

    const allSubtopicIds = [...new Set(recent.flatMap((r) => r.relatedSubtopicIds ?? []))];
    const subtopicRows = allSubtopicIds.length
      ? await db.select({ id: subtopics.id, topicText: subtopics.topicText }).from(subtopics).where(inArray(subtopics.id, allSubtopicIds))
      : [];
    const textById = Object.fromEntries(subtopicRows.map((s) => [s.id, s.topicText]));

    // "Update as per instructions from the once-a-week AI" -- no new AI
    // call here, just reading the already-computed weekly nudge (see
    // lib/adaptive/weeklyFocus.js) and flagging which items intersect it,
    // so this week's priorities surface first without re-deciding anything.
    const focus = await currentWeekFocus(userId);
    const focusIds = focus?.subtopicIds ?? new Set();

    const items = recent.map((r) => ({
      id: r.id,
      publishedDate: r.publishedDate,
      title: r.title,
      summary: r.summary,
      sourceUrl: r.sourceUrl,
      sourceName: r.sourceName,
      relatedTopics: (r.relatedSubtopicIds ?? []).map((id) => ({ id, topicText: textById[id] })).filter((t) => t.topicText),
      relevantToThisWeek: (r.relatedSubtopicIds ?? []).some((id) => focusIds.has(id)),
    }));
    items.sort((a, b) => (b.relevantToThisWeek ? 1 : 0) - (a.relevantToThisWeek ? 1 : 0));

    return NextResponse.json({ items, weekFocusNote: focus?.note || null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
