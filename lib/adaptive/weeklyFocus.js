// lib/adaptive/weeklyFocus.js
//
// Reads THIS week's already-computed weeklyPlanAdjustments row (written
// once a week by app/api/cron/weekly-replan -- see
// lib/ai/weeklyReplanAdjustment.js) and turns it into something the DAILY
// current-affairs digest and newspaper reader can act on: "update as per
// instructions from the once-a-week AI" (explicit request). Deliberately
// no new AI call here -- the weekly AI already decided what matters this
// week (focusSubtopicIds/extraRevisionSubtopicIds); this module just
// resolves those ids to real subject/topic data and, for the newspaper
// (which has no subtopic tagging of its own, unlike current-affairs
// items), a small keyword list for a plain deterministic substring match.

import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { subjectUnlocks, weeklyPlanAdjustments, subtopics, subjects } from "../../db/schema.js";
import { dayNumberForDate } from "./planEngine.js";
import { planStartDate } from "./subjectUnlockState.js";

// Words too generic to usefully match a headline against (syllabus section
// names and topic text are full of these) -- filtered out of the keyword
// list rather than trusted to not collide with unrelated news.
const STOPWORDS = new Set([
  "and", "the", "of", "for", "with", "its", "their", "issues", "related", "india", "indian",
  "national", "international", "system", "systems", "policy", "policies", "general", "studies",
]);

function keywordsFromText(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
}

/** This week's focus, or null if no adjustment has been written yet (week 0, or the cron hasn't run for this user this week). */
export async function currentWeekFocus(userId) {
  const [unlock] = await db.select({ userId: subjectUnlocks.userId }).from(subjectUnlocks).where(eq(subjectUnlocks.userId, userId));
  if (!unlock) return null;

  const start = await planStartDate(userId);
  if (!start) return null;
  const weekIndex = Math.floor(dayNumberForDate(start, new Date()) / 7);

  const [adjustment] = await db
    .select()
    .from(weeklyPlanAdjustments)
    .where(and(eq(weeklyPlanAdjustments.userId, userId), eq(weeklyPlanAdjustments.weekIndex, weekIndex)));
  if (!adjustment) return null;

  const ids = [...adjustment.focusSubtopicIds, ...adjustment.extraRevisionSubtopicIds];
  if (!ids.length) return { subtopicIds: new Set(), note: adjustment.note, keywords: [] };

  const subtopicRows = await db.select().from(subtopics).where(inArray(subtopics.id, ids));
  const subjectIds = [...new Set(subtopicRows.map((s) => s.subjectId))];
  const subjectRows = subjectIds.length ? await db.select().from(subjects).where(inArray(subjects.id, subjectIds)) : [];
  const subjectNameById = Object.fromEntries(subjectRows.map((s) => [s.id, s.displayName]));

  const keywordSet = new Set();
  for (const s of subtopicRows) {
    for (const w of keywordsFromText(subjectNameById[s.subjectId])) keywordSet.add(w);
    for (const w of keywordsFromText(s.section)) keywordSet.add(w);
    for (const w of keywordsFromText(s.topicText)) keywordSet.add(w);
  }

  return { subtopicIds: new Set(ids), note: adjustment.note, keywords: [...keywordSet] };
}

/** Whether a piece of free text (a headline) matches this week's focus keywords -- plain case-insensitive substring match, no AI. */
export function matchesFocusKeywords(text, keywords) {
  if (!keywords?.length) return false;
  const lower = (text || "").toLowerCase();
  return keywords.some((k) => lower.includes(k));
}
