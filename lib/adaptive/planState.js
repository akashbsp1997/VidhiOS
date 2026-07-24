// lib/adaptive/planState.js
//
// DB-touching wrapper around lib/adaptive/planEngine.js -- same split as
// subjectUnlocks.js/subjectUnlockState.js. Builds the real subtopic pool
// (only from subjects the student has actually unlocked, see
// lib/adaptive/subjectUnlockState.js) and hands it to the pure scheduler.
//
// Deliberately scoped to GATED_CATEGORIES (gs + optional) -- "along with one
// optional" was the user's own framing for this piece, and prelims/essay/
// qualifying-language don't have the same subtopic-by-subtopic teach content
// this schedule is built around. A subject not yet unlocked isn't in the
// pool at all: rather than simulating the FUTURE unlock schedule here too
// (duplicating lib/adaptive/subjectUnlocks.js's own timing rules), this
// recomputes live from each subject's REAL unlockedAt every time the plan is
// viewed -- if GS III unlocks early via mastery, the very next /api/plan
// request already reflects it, no separate sync needed.

import { eq, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { subjectUnlocks, subjects, subtopics, mastery, sources, pyqs, playerState } from "../../db/schema.js";
import { computeDifficultyScore } from "./unlocks.js";
import { loadUnlockedSubjectIds, planStartDate } from "./subjectUnlockState.js";
import { dayNumberForDate, buildDayPlan, buildFixedWeekPlan, TOTAL_FIXED_WEEK_DAYS } from "./planEngine.js";

/**
 * Everything the plan engine needs for this user, or null if onboarding
 * hasn't run yet (no plan start date exists).
 */
export async function loadPlanContext(userId) {
  const start = await planStartDate(userId);
  if (!start) return null;

  const { unlockedGsIds, optionalSubjectId } = await loadUnlockedSubjectIds(userId);
  const unlockedSubjectIds = optionalSubjectId ? [...unlockedGsIds, optionalSubjectId] : unlockedGsIds;
  if (!unlockedSubjectIds.length) return null;

  const [ps] = await db.select({ track: playerState.track }).from(playerState).where(eq(playerState.userId, userId));

  const unlockRows = await db.select().from(subjectUnlocks).where(eq(subjectUnlocks.userId, userId));
  const unlockedAtBySubject = Object.fromEntries(unlockRows.map((r) => [r.subjectId, r.unlockedAt]));

  const subjectRows = await db.select({ id: subjects.id, displayName: subjects.displayName }).from(subjects).where(inArray(subjects.id, unlockedSubjectIds));
  const subjectById = Object.fromEntries(subjectRows.map((s) => [s.id, s]));

  const subtopicRows = await db.select().from(subtopics).where(inArray(subtopics.subjectId, unlockedSubjectIds));
  const ids = subtopicRows.map((s) => s.id);

  const masteryRows = ids.length ? await db.select().from(mastery).where(eq(mastery.userId, userId)) : [];
  const masteryBySubtopic = Object.fromEntries(masteryRows.map((m) => [m.subtopicId, m]));

  const sourceRows = ids.length ? await db.select().from(sources).where(inArray(sources.subtopicId, ids)) : [];
  const sourcesBySubtopic = {};
  for (const row of sourceRows) {
    (sourcesBySubtopic[row.subtopicId] ??= []).push({ sourceTier: row.sourceTier, ncertLevel: row.ncertLevel, ncertClass: row.ncertClass });
  }

  const allPyqs = ids.length ? await db.select({ topics: pyqs.topics, marks: pyqs.marks }).from(pyqs) : [];
  const pyqMarksBySubtopic = {};
  for (const q of allPyqs) {
    for (const t of q.topics) {
      if (ids.includes(t)) (pyqMarksBySubtopic[t] ??= []).push(q.marks);
    }
  }

  const planSubtopics = subtopicRows.map((s) => ({
    id: s.id,
    subjectId: s.subjectId,
    subjectDisplayName: subjectById[s.subjectId]?.displayName ?? s.subjectId,
    paper: s.paper,
    topicText: s.topicText,
    pyqFrequency: s.pyqFrequency,
    difficultyScore: computeDifficultyScore(sourcesBySubtopic[s.id], pyqMarksBySubtopic[s.id]),
    masteryScore: masteryBySubtopic[s.id]?.masteryScore ?? 0,
    selfStatus: masteryBySubtopic[s.id]?.selfStatus ?? "not-started",
    availableFromDay: Math.max(0, dayNumberForDate(start, unlockedAtBySubject[s.subjectId] ?? start)),
  }));

  return { planStartDate: start, subtopics: planSubtopics, track: ps?.track ?? null, unlockedGsIds };
}

/**
 * The day-by-day schedule for [fromDay, toDay], enriched with subtopic
 * display data so the client never needs a second round trip. Returns null
 * if onboarding hasn't run (route turns this into "set up your plan first").
 */
export async function getPlanWindow(userId, { fromDay, toDay }) {
  const ctx = await loadPlanContext(userId);
  if (!ctx) return null;

  const todayDayNumber = dayNumberForDate(ctx.planStartDate, new Date());

  // A student with an assigned track (Part E2's preloaded 7-day habit week)
  // sees the fixed curriculum for days 0-6; day 7 onward falls through to
  // the normal computed engine, with whatever the fixed week already
  // covered excluded from its pool so nothing gets scheduled twice.
  const fixedWeek = ctx.track ? buildFixedWeekPlan(ctx.subtopics, ctx.track, ctx.unlockedGsIds) : null;

  let days, learnDayBySubtopic;
  if (fixedWeek) {
    // learnDayBySubtopic must stay a FULL assignment across every subtopic
    // (like buildDayPlan's own always does, independent of the requested
    // window -- see assignLearningDays) so learnedSoFar/scheduledThroughDay
    // below stay accurate even when the caller only asked for a window
    // inside days 0-6. The computed call's own `days` naturally comes back
    // empty when toDay hasn't reached day 7 yet (fromDay > toDay).
    const remainingPool = ctx.subtopics.filter((s) => !fixedWeek.learnDayBySubtopic.has(s.id));
    const computed = buildDayPlan(remainingPool, { fromDay: Math.max(fromDay, TOTAL_FIXED_WEEK_DAYS), toDay, startDay: TOTAL_FIXED_WEEK_DAYS });

    learnDayBySubtopic = new Map(fixedWeek.learnDayBySubtopic);
    for (const [id, span] of computed.learnDayBySubtopic) learnDayBySubtopic.set(id, span);

    days = [...fixedWeek.days.filter((d) => d.day >= fromDay && d.day <= toDay), ...computed.days].sort((a, b) => a.day - b.day);
  } else {
    ({ days, learnDayBySubtopic } = buildDayPlan(ctx.subtopics, { fromDay, toDay }));
  }

  const subtopicById = Object.fromEntries(ctx.subtopics.map((s) => [s.id, s]));

  const enrichedDays = days.map((d) => ({
    ...d,
    topics: d.subtopicIds.map((id) => {
      const s = subtopicById[id];
      const span = learnDayBySubtopic.get(id);
      // "day X of Y" for a multi-day subtopic (2026-07-24 "rewrite Teach"
      // change) -- both default to 1 for a topic outside learnDayBySubtopic
      // (shouldn't happen in practice, but keeps this defensive).
      const totalSpanDays = span ? span.endDay - span.startDay + 1 : 1;
      const dayOfSpan = span ? Math.min(totalSpanDays, Math.max(1, d.day - span.startDay + 1)) : 1;
      return { id, topicText: s?.topicText ?? id, subjectDisplayName: s?.subjectDisplayName ?? "", masteryScore: s?.masteryScore ?? 0, dayOfSpan, totalSpanDays };
    }),
  }));

  const totalSubtopics = ctx.subtopics.length;
  // .endDay -- "learned so far" now means the subtopic's full multi-day span
  // has completed, not just started.
  const learnedSoFar = ctx.subtopics.filter((s) => (learnDayBySubtopic.get(s.id)?.endDay ?? Infinity) <= todayDayNumber).length;
  const scheduledThroughDay = ctx.subtopics.length ? Math.max(...ctx.subtopics.map((s) => learnDayBySubtopic.get(s.id)?.endDay ?? 0)) : 0;

  return {
    planStartDate: ctx.planStartDate.toISOString(),
    todayDayNumber,
    totalSubtopics,
    learnedSoFar,
    scheduledThroughDay,
    days: enrichedDays,
  };
}
