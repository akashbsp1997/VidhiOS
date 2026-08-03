// lib/ai/contentGrounding.js
//
// Shared grounding inputs for content-first question generation (see the
// 2026-07-24 "content-first" change) -- factored out once instead of being
// re-fetched separately in app/api/attempt/route.js, app/api/mcq/route.js,
// and the module-Test generation path, since all three now need the same two
// things: a subtopic's recent tagged current-affairs items, and a small
// sample of real PYQs to use as a style/difficulty REFERENCE (never served
// as the question itself -- see lib/ai/generateQuestion.js's anti-leak
// wording for how that reference is used in the actual prompt).

import { and, gte, sql, desc } from "drizzle-orm";
import { db } from "../db.js";
import { currentAffairsItems } from "../../db/schema.js";
import { shuffled } from "../utils/shuffle.js";

/**
 * Recent current-affairs items tagged to this subtopic
 * (currentAffairsItems.relatedSubtopicIds, an existing structured array
 * column populated by app/api/cron/fetch-current-affairs/route.js but never
 * queried by anything else until now). Best-effort: most subtopics won't
 * have any, especially doctrinal/legal ones with little current-affairs
 * angle -- callers must handle an empty array gracefully, same as they
 * already do for sparse `sources.extractedText`.
 */
export async function recentCurrentAffairsExcerpts(subtopicId, { days = 60, limit = 5 } = {}) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db
    .select({ title: currentAffairsItems.title, summary: currentAffairsItems.summary, publishedDate: currentAffairsItems.publishedDate })
    .from(currentAffairsItems)
    .where(and(sql`${subtopicId} = ANY(${currentAffairsItems.relatedSubtopicIds})`, gte(currentAffairsItems.publishedDate, cutoff)))
    .orderBy(desc(currentAffairsItems.publishedDate))
    .limit(limit);
  return rows;
}

/**
 * Up to `count` real PYQs from an already-fetched pool, to feed into a
 * generation prompt as a reference (pure, no DB -- caller already has
 * pyqPool from its own subtopic-scoped query). Prefers ones this user
 * hasn't already seen served as a reference before, same "prefer unseen"
 * bias chooseQuestionPlan used when PYQs were still directly served.
 * Returns [] when the pool is empty (a subtopic with zero real PYQs, e.g.
 * CSAT quant, degrades gracefully -- generation just runs ungrounded by any
 * PYQ, same as it already does when sourceExcerpts is empty).
 */
export function pickReferencePyqs(pyqPool, seenQuestionRefIds, { count = 2 } = {}) {
  if (!pyqPool || !pyqPool.length) return [];
  const seen = new Set((seenQuestionRefIds || []).map(String));
  const unseen = pyqPool.filter((q) => !seen.has(String(q.id)));
  const pool = unseen.length ? unseen : pyqPool;
  return shuffled(pool)
    .slice(0, count)
    .map((q) => ({ id: q.id, questionText: q.questionText, marks: q.marks, year: q.year }));
}

const TIER_LABEL = {
  ncert: "NCERT sources",
  official: "Government / official sources",
  newspaper: "Newspaper / current-affairs sources",
  private_vendor: "Other reference sources",
  // Bloom Knowledge Forest -- a student's own procured material
  // (db/schema.js's personalSources), private to them, never mixed into
  // any other user's grounding. Listed last: the most personalized/
  // advanced tier, not a replacement for the shared catalog above it.
  personal: "Your own uploaded material",
};
const MAX_EXCERPTS_PER_TIER = 3;
const MAX_CHARS_PER_EXCERPT = 2500;

/**
 * Groups a subtopic's real source rows into one labeled block PER TIER
 * (NCERT, government/official, newspaper, other, plus the calling user's
 * own uploads if given) instead of one flat, undifferentiated blob -- so a
 * generation prompt can actually see it has material from multiple
 * categories and is expected to draw on all of them, not just whichever
 * excerpt happened to sort first.
 *
 * Live gap (2026-07-26, per explicit request: Teach content wasn't drawing
 * on "each and every aspect... available in ncerts govt sources and
 * external sources"): the previous approach sorted every source row by
 * tier priority and took the top 2 OVERALL -- for a subtopic with real
 * NCERT, government, AND external material, that meant only the highest-
 * priority 1-2 rows (almost always NCERT) ever reached the prompt, and
 * everything else was silently dropped regardless of how much was
 * registered. This takes up to MAX_EXCERPTS_PER_TIER from EACH tier that
 * has any, so a subtopic with all three categories actually gets all
 * three represented.
 *
 * `personalRows` (optional) are the CALLING USER's own personalSources
 * rows for this subtopic -- caller is responsible for scoping that query
 * to the right userId, this function just buckets/labels whatever it's
 * given, same as it does for the global `sourceRows`.
 *
 * Returns a string[] (one entry per tier that has content) -- callers
 * already join an array of blocks with "\n\n" for their prompt, this just
 * changes what each block IS (a whole tier's excerpts, labeled) instead of
 * one source row's raw text.
 */
export function labeledSourceExcerptBlocks(sourceRows, personalRows = []) {
  const byTier = { ncert: [], official: [], newspaper: [], private_vendor: [], personal: [] };
  for (const row of sourceRows) {
    if (!row.extractedText) continue;
    // Untiered rows (added before sourceTier existed) bucket into
    // "official" -- same "official-equivalent" convention
    // lib/sources/tiers.js's sortByTierPriority already uses for them.
    // A row can never legitimately claim the "personal" tier itself --
    // that's reserved for personalRows below.
    const tier = byTier[row.sourceTier] && row.sourceTier !== "personal" ? row.sourceTier : "official";
    if (byTier[tier].length < MAX_EXCERPTS_PER_TIER) byTier[tier].push(row.extractedText.slice(0, MAX_CHARS_PER_EXCERPT));
  }
  for (const row of personalRows) {
    if (!row.extractedText) continue;
    if (byTier.personal.length < MAX_EXCERPTS_PER_TIER) byTier.personal.push(row.extractedText.slice(0, MAX_CHARS_PER_EXCERPT));
  }
  return Object.entries(TIER_LABEL)
    .filter(([tier]) => byTier[tier].length)
    .map(([tier, label]) => `${label}:\n"""\n${byTier[tier].join("\n---\n")}\n"""`);
}
