// app/api/setup/backfill-current-affairs/route.js
//
// One-time, manually-triggered "extensive" current-affairs pull -- distinct
// from app/api/cron/fetch-current-affairs (unchanged, still the cheap daily
// job: one generic category fetch, ~10 articles). This one builds a query
// PER REAL SYLLABUS SECTION (subtopics.section, e.g. "Indian Government and
// Politics") instead of NewsData's generic categories, so the articles it
// pulls are actually grounded in what's being taught/tested -- "based on
// syllabus" -- and orders those queries by each section's total pyqFrequency
// (highest-yield first) -- "based on PYQs" -- so if a run doesn't get
// through every section, the exam-heaviest ones are covered first. Article-
// to-subtopic tagging itself reuses the exact same summarizeCurrentAffairs
// call the daily cron already uses, unchanged.
//
// Resumable via ?cursor=, same "process a bounded slice, tell the caller
// where to continue" pattern as /api/ingest/structure's chunking -- a
// single call processing every syllabus section could run for minutes
// (dozens of NewsData calls + AI summarization batches), well past any
// serverless maxDuration. Re-visit the URL with the returned `continueAt`
// query string to keep going; `done: true` means every section's been
// covered for this run.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { subjects, subtopics, currentAffairsItems } from "../../../../db/schema.js";
import { summarizeCurrentAffairs } from "../../../../lib/ai/currentAffairs.js";

const NEWSDATA_URL = "https://newsdata.io/api/1/news";
// Live failure (2026-07-26): NewsData's free tier rejects more than 5
// categories in one query ("Number of category cannot exceeded 5 in a
// single query", HTTP 422) -- matches the same fix in
// app/api/cron/fetch-current-affairs/route.js, see that file's comment for
// why "top" is the one dropped.
const CATEGORIES = "politics,business,environment,world,science";
// NewsData credits per call this route makes -- well under the free tier's
// 30-credits/15-minute window (see NewsData's rate-limit docs) even across
// a couple of consecutive runs, and small enough that QUERIES_PER_RUN
// sequential NewsData + AI calls comfortably fit maxDuration.
const QUERIES_PER_RUN = 6;
// Matches app/api/cron/fetch-current-affairs's own per-run article count --
// a much larger batch risks the exact oversized-request failure fixed in
// lib/ai/client.js's Groq-fallback truncation (2026-07-24).
const SUMMARIZE_BATCH_SIZE = 10;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!process.env.SETUP_SECRET || key !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Missing or wrong ?key=. Check SETUP_SECRET in your Vercel env vars." }, { status: 401 });
  }
  if (!process.env.NEWSDATA_API_KEY) {
    return NextResponse.json({ error: "NEWSDATA_API_KEY isn't set -- add it to your Vercel env vars first." }, { status: 400 });
  }

  const cursor = Math.max(0, Number(searchParams.get("cursor") ?? 0) || 0);

  try {
    // GS + optional subjects only -- same scoping as the daily cron (current
    // affairs realistically maps to syllabus topics, not Essay/qualifying-
    // language papers).
    const gatedSubjects = await db.select({ id: subjects.id }).from(subjects).where(inArray(subjects.category, ["gs", "optional"]));
    const subtopicRows = gatedSubjects.length
      ? await db
          .select({ id: subtopics.id, topicText: subtopics.topicText, section: subtopics.section, pyqFrequency: subtopics.pyqFrequency })
          .from(subtopics)
          .where(inArray(subtopics.subjectId, gatedSubjects.map((s) => s.id)))
      : [];

    if (!subtopicRows.length) {
      return NextResponse.json({ status: "ok", message: "No syllabus subtopics found yet -- seed subjects/subtopics first.", done: true });
    }

    // One query per real syllabus section, highest total PYQ frequency
    // first (see file header).
    const sectionWeight = new Map();
    for (const s of subtopicRows) sectionWeight.set(s.section, (sectionWeight.get(s.section) || 0) + s.pyqFrequency);
    const allQueries = [...sectionWeight.entries()].sort((a, b) => b[1] - a[1]).map(([section]) => section.slice(0, 100)); // NewsData's q param: 100-char limit on the free tier

    const batch = allQueries.slice(cursor, cursor + QUERIES_PER_RUN);
    if (!batch.length) {
      return NextResponse.json({ status: "ok", message: "cursor is past the end of the query list -- nothing left to fetch.", totalQueries: allQueries.length, done: true });
    }
    const nextCursor = cursor + batch.length;
    const done = nextCursor >= allQueries.length;

    const validSubtopicIds = new Set(subtopicRows.map((s) => s.id));
    const subtopicOptions = subtopicRows.map((s) => ({ id: s.id, topicText: s.topicText }));
    const today = new Date().toISOString().slice(0, 10);

    let fetchedTotal = 0;
    let insertedTotal = 0;
    const seenUrlsThisRun = new Set();
    const perQueryLog = [];

    for (const query of batch) {
      const url = `${NEWSDATA_URL}?apikey=${process.env.NEWSDATA_API_KEY}&country=in&category=${CATEGORIES}&language=en&q=${encodeURIComponent(query)}`;
      let results = [];
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          results = Array.isArray(data.results) ? data.results : [];
        } else {
          // NewsData's error body carries the actual reason (e.g. an
          // unsupported parameter combination, an invalid query) -- the
          // status code alone isn't enough to diagnose a live failure by.
          const bodyText = await res.text().catch(() => "");
          let reason = bodyText.slice(0, 300);
          try {
            const parsed = JSON.parse(bodyText);
            reason = parsed?.results?.message || parsed?.message || reason;
          } catch {
            // bodyText wasn't JSON -- fall back to the raw text above
          }
          perQueryLog.push(`"${query}": NewsData returned ${res.status} -- ${reason}, skipped`);
          continue;
        }
      } catch (err) {
        perQueryLog.push(`"${query}": ${err.message}, skipped`);
        continue;
      }
      fetchedTotal += results.length;

      const newArticles = results.filter((r) => r.link && r.title && !seenUrlsThisRun.has(r.link));
      if (!newArticles.length) {
        perQueryLog.push(`"${query}": ${results.length} fetched, 0 new`);
        continue;
      }

      const existing = await db
        .select({ sourceUrl: currentAffairsItems.sourceUrl })
        .from(currentAffairsItems)
        .where(inArray(currentAffairsItems.sourceUrl, newArticles.map((a) => a.link)));
      const existingUrls = new Set(existing.map((r) => r.sourceUrl));
      const trulyNew = newArticles.filter((a) => !existingUrls.has(a.link));
      for (const a of trulyNew) seenUrlsThisRun.add(a.link);

      let insertedForQuery = 0;
      for (let i = 0; i < trulyNew.length; i += SUMMARIZE_BATCH_SIZE) {
        const chunk = trulyNew.slice(i, i + SUMMARIZE_BATCH_SIZE);
        const summarized = await summarizeCurrentAffairs({
          articles: chunk.map((a) => ({ title: a.title, description: a.description })),
          subtopicOptions,
        });
        const rows = chunk.map((a, idx) => ({
          publishedDate: today,
          title: a.title,
          summary: summarized[idx]?.summary || (a.description || "").slice(0, 300),
          sourceUrl: a.link,
          sourceName: a.source_id ?? null,
          relatedSubtopicIds: (summarized[idx]?.relatedSubtopicIds ?? []).filter((id) => validSubtopicIds.has(id)),
        }));
        const inserted = await db.insert(currentAffairsItems).values(rows).onConflictDoNothing({ target: currentAffairsItems.sourceUrl }).returning();
        insertedForQuery += inserted.length;
      }
      insertedTotal += insertedForQuery;
      perQueryLog.push(`"${query}": ${results.length} fetched, ${trulyNew.length} new, ${insertedForQuery} inserted`);
    }

    return NextResponse.json({
      status: "ok",
      cursor,
      nextCursor,
      totalQueries: allQueries.length,
      fetchedTotal,
      insertedTotal,
      perQueryLog,
      done,
      ...(done ? {} : { continueAt: `/api/setup/backfill-current-affairs?key=${encodeURIComponent(key)}&cursor=${nextCursor}` }),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ status: "error", message: err.message }, { status: 500 });
  }
}
