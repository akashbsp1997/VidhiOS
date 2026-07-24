// app/api/cron/weekly-replan/route.js
//
// Wired to Vercel Cron via vercel.json, once nightly, scheduled AFTER
// grade-daily-answers (so this week's attempts are already scored) and
// prepare-next-day. Runs daily, but only does real work for a user once
// they've crossed a new 7-day boundary AND that week's adjustment hasn't
// been written yet (existence check on weeklyPlanAdjustments, not an exact
// `daysElapsed % 7 === 0` gate) -- self-healing if a single run is missed or
// fails partway, since the next day's run just picks the same user back up.
//
// One AI call per user per week (see lib/ai/weeklyReplanAdjustment.js):
// reads the week just completed (real graded attempts + a weekly mock test
// score, when one exists) and current mastery, writes a small structured
// nudge that lib/adaptive/planEngine.js's buildDayPlan applies as a soft
// bias on top of its existing deterministic schedule -- this augments that
// engine, it never replaces it (see db/schema.js's weeklyPlanAdjustments
// comment).
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { eq, and, gte, lt, isNotNull, desc } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { subjectUnlocks, attempts, mockTests, weeklyPlanAdjustments } from "../../../../db/schema.js";
import { loadPlanContext } from "../../../../lib/adaptive/planState.js";
import { dayNumberForDate, dateForDayNumber, byScheduleOrder } from "../../../../lib/adaptive/planEngine.js";
import { generateWeeklyReplanAdjustment } from "../../../../lib/ai/weeklyReplanAdjustment.js";

// One AI call per user -- same conservative budget as grade-daily-answers'
// MAX_ITEMS_PER_TYPE_PER_RUN, this route's own 90s maxDuration shared across
// however many users are due this run.
const MAX_USERS_PER_RUN = 10;
const MAX_UPCOMING_CANDIDATES = 15; // keeps the prompt bounded; only the soonest-scheduled matter

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.select({ userId: subjectUnlocks.userId }).from(subjectUnlocks);
  const userIds = [...new Set(rows.map((r) => r.userId))];

  let adjustmentsWritten = 0;
  const results = [];

  for (const userId of userIds) {
    if (adjustmentsWritten >= MAX_USERS_PER_RUN) {
      results.push({ userId, status: "skipped-run-cap" });
      continue;
    }
    try {
      const ctx = await loadPlanContext(userId);
      if (!ctx) {
        results.push({ userId, status: "no-plan" });
        continue;
      }

      const todayDayNumber = dayNumberForDate(ctx.planStartDate, new Date());
      const currentWeekIndex = Math.floor(todayDayNumber / 7);
      if (currentWeekIndex < 1) {
        results.push({ userId, status: "still-in-week-0" }); // nothing to read yet
        continue;
      }

      const [existing] = await db
        .select({ weekIndex: weeklyPlanAdjustments.weekIndex })
        .from(weeklyPlanAdjustments)
        .where(and(eq(weeklyPlanAdjustments.userId, userId), eq(weeklyPlanAdjustments.weekIndex, currentWeekIndex)));
      if (existing) {
        results.push({ userId, status: "already-generated" });
        continue;
      }

      const weekStart = dateForDayNumber(ctx.planStartDate, (currentWeekIndex - 1) * 7);
      const weekEnd = dateForDayNumber(ctx.planStartDate, currentWeekIndex * 7);
      const subtopicById = Object.fromEntries(ctx.subtopics.map((s) => [s.id, s]));

      const weekAttemptRows = await db
        .select({ subtopicId: attempts.subtopicId, score: attempts.score })
        .from(attempts)
        .where(and(eq(attempts.userId, userId), isNotNull(attempts.score), gte(attempts.createdAt, weekStart), lt(attempts.createdAt, weekEnd)));
      const weekAttempts = weekAttemptRows.map((r) => ({
        subtopicId: r.subtopicId,
        topicText: subtopicById[r.subtopicId]?.topicText ?? r.subtopicId,
        score: r.score,
      }));

      const [weeklyTest] = await db
        .select({ totalScore: mockTests.totalScore, totalMarks: mockTests.totalMarks })
        .from(mockTests)
        .where(and(eq(mockTests.userId, userId), isNotNull(mockTests.totalScore), gte(mockTests.startedAt, weekStart), lt(mockTests.startedAt, weekEnd)))
        .orderBy(desc(mockTests.startedAt))
        .limit(1);
      const weeklyTestScore = weeklyTest && weeklyTest.totalMarks > 0 ? Math.round((weeklyTest.totalScore / weeklyTest.totalMarks) * 100) : null;

      const learnedSoFarIds = new Set(weekAttempts.map((a) => a.subtopicId));
      // Broaden "learned so far" beyond just this week's attempts -- any
      // subtopic with real prior mastery (score > 0, meaning at least one
      // graded attempt ever) is a valid extraRevisionSubtopicIds candidate,
      // not only ones touched this specific week.
      for (const s of ctx.subtopics) if (s.masteryScore > 0) learnedSoFarIds.add(s.id);
      const learnedSoFar = [...learnedSoFarIds].map((id) => subtopicById[id]).filter(Boolean).map((s) => ({ id: s.id, topicText: s.topicText, masteryScore: s.masteryScore }));

      const upcoming = ctx.subtopics
        .filter((s) => !learnedSoFarIds.has(s.id))
        .sort(byScheduleOrder(null))
        .slice(0, MAX_UPCOMING_CANDIDATES)
        .map((s) => ({ id: s.id, topicText: s.topicText }));

      if (!weekAttempts.length && !learnedSoFar.length) {
        results.push({ userId, status: "nothing-to-analyze" });
        continue;
      }

      const adjustment = await generateWeeklyReplanAdjustment({ weekAttempts, weeklyTestScore, learnedSoFar, upcoming });

      await db
        .insert(weeklyPlanAdjustments)
        .values({ userId, weekIndex: currentWeekIndex, ...adjustment })
        .onConflictDoUpdate({ target: [weeklyPlanAdjustments.userId, weeklyPlanAdjustments.weekIndex], set: { ...adjustment, generatedAt: new Date() } });

      adjustmentsWritten++;
      results.push({ userId, status: "ok", weekIndex: currentWeekIndex });
    } catch (err) {
      console.error(`weekly-replan: user ${userId} failed:`, err.message);
      results.push({ userId, status: "error", error: err.message });
    }
  }

  return NextResponse.json({ usersChecked: userIds.length, adjustmentsWritten, results });
}
