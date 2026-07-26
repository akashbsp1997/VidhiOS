// app/api/cron/fetch-current-affairs/route.js
//
// Wired to Vercel Cron via vercel.json (daily). Pulls today's India-focused
// news from NewsData.io's free tier, condenses + tags each new article in
// ONE batched AI call (see lib/ai/currentAffairs.js -- not one call per
// article), and stores results in current_affairs_items. Entirely opt-in:
// no-ops with a clear message if NEWSDATA_API_KEY isn't set, same
// convention as lib/ai/client.js's Groq fallback and the reminder-email cron.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { subtopics, subjects, currentAffairsItems } from "../../../../db/schema.js";
import { summarizeCurrentAffairs } from "../../../../lib/ai/currentAffairs.js";

const NEWSDATA_URL = "https://newsdata.io/api/1/news";
// UPSC-relevant categories on NewsData.io's free tier. India-scoped
// (country=in) since that's the exam's own focus.
//
// Live failure (2026-07-26): NewsData's free tier rejects more than 5
// categories in one query ("Number of category cannot exceeded 5 in a
// single query", HTTP 422) -- the original 6-category list ("top" included
// as a catch-all) meant EVERY call this route has ever made failed
// silently (this GET already treats any non-2xx as a clean "error" status
// without surfacing it anywhere visible day to day, since it's a cron with
// no one watching its response). Dropped "top" -- the 5 remaining
// categories are the ones actually mapped to a GS/optional paper; "top"
// was just insurance against gaps those already mostly cover.
const CATEGORIES = "politics,business,environment,world,science";
const MAX_ARTICLES_PER_RUN = 10;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.NEWSDATA_API_KEY) {
    return NextResponse.json({ status: "skipped", message: "NEWSDATA_API_KEY not set -- the current-affairs digest is opt-in." });
  }

  try {
    const url = `${NEWSDATA_URL}?apikey=${process.env.NEWSDATA_API_KEY}&country=in&category=${CATEGORIES}&language=en`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ status: "error", message: `NewsData.io returned ${res.status}: ${text.slice(0, 300)}` }, { status: 502 });
    }
    const data = await res.json();
    const results = (Array.isArray(data.results) ? data.results : []).slice(0, MAX_ARTICLES_PER_RUN);

    const candidateUrls = results.map((r) => r.link).filter(Boolean);
    const existing = candidateUrls.length
      ? await db.select({ sourceUrl: currentAffairsItems.sourceUrl }).from(currentAffairsItems).where(inArray(currentAffairsItems.sourceUrl, candidateUrls))
      : [];
    const existingUrls = new Set(existing.map((r) => r.sourceUrl));
    const newArticles = results.filter((r) => r.link && r.title && !existingUrls.has(r.link));

    if (!newArticles.length) {
      return NextResponse.json({ status: "ok", fetched: results.length, inserted: 0 });
    }

    // GS + optional subjects only -- current affairs realistically maps to
    // syllabus topics, not Essay/qualifying-language papers.
    const gatedSubjects = await db.select({ id: subjects.id }).from(subjects).where(inArray(subjects.category, ["gs", "optional"]));
    const subtopicRows = gatedSubjects.length
      ? await db.select({ id: subtopics.id, topicText: subtopics.topicText }).from(subtopics).where(inArray(subtopics.subjectId, gatedSubjects.map((s) => s.id)))
      : [];

    const summarized = await summarizeCurrentAffairs({
      articles: newArticles.map((a) => ({ title: a.title, description: a.description })),
      subtopicOptions: subtopicRows,
    });

    const validSubtopicIds = new Set(subtopicRows.map((s) => s.id));
    const today = new Date().toISOString().slice(0, 10);
    const rows = newArticles.map((a, i) => ({
      publishedDate: today,
      title: a.title,
      summary: summarized[i]?.summary || (a.description || "").slice(0, 300),
      sourceUrl: a.link,
      sourceName: a.source_id ?? null,
      relatedSubtopicIds: (summarized[i]?.relatedSubtopicIds ?? []).filter((id) => validSubtopicIds.has(id)),
    }));

    const inserted = await db.insert(currentAffairsItems).values(rows).onConflictDoNothing({ target: currentAffairsItems.sourceUrl }).returning();

    return NextResponse.json({ status: "ok", fetched: results.length, inserted: inserted.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ status: "error", message: err.message }, { status: 500 });
  }
}
