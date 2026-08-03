// app/api/newspaper/route.js
//
// GET -> today's headlines from The Hindu, grouped by section, fetched live
// from its own public RSS feeds (see lib/news/hinduRss.js). Headline + link
// only -- students read the real article on the source site.
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { fetchDailyNewspaper } from "../../../lib/news/hinduRss.js";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const data = await fetchDailyNewspaper();
  return NextResponse.json(data);
}
