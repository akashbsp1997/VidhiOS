// app/api/newspaper/route.js
//
// GET -> today's headlines from The Hindu, grouped by section, fetched live
// from its own public RSS feeds (see lib/news/hinduRss.js). Headline + link
// only -- students read the real article on the source site.
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { fetchDailyNewspaper } from "../../../lib/news/hinduRss.js";
import { currentWeekFocus, matchesFocusKeywords } from "../../../lib/adaptive/weeklyFocus.js";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [data, focus] = await Promise.all([fetchDailyNewspaper(), currentWeekFocus(userId)]);

  // "Update as per instructions from the once-a-week AI" -- the newspaper
  // has no subtopic tagging of its own (unlike current-affairs items), so
  // this is a plain keyword match against this week's focus subjects/
  // topics rather than an id intersection. No new AI call.
  const keywords = focus?.keywords ?? [];
  const sections = data.sections.map((section) => {
    const items = section.items
      .map((item) => ({ ...item, relevantToThisWeek: matchesFocusKeywords(item.title, keywords) }))
      .sort((a, b) => (b.relevantToThisWeek ? 1 : 0) - (a.relevantToThisWeek ? 1 : 0));
    return { ...section, items };
  });

  return NextResponse.json({ ...data, sections, weekFocusNote: focus?.note || null });
}
