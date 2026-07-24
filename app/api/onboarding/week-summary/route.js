// app/api/onboarding/week-summary/route.js
//
// GET -> the "Week 1 game score" card for a student who's gone through Part
// E2's fixed onboarding week: days completed (E3's "write your answer"
// checks), missions/XP earned in that window, and a weekly test score if
// one exists. Assembled entirely from existing tables (daily_mission_log,
// attempts via loadFixedWeekCompletion, mock_tests, player_state) -- no new
// mutable state, same "derive it, don't duplicate it" approach missions/
// streaks already use.
import { NextResponse } from "next/server";
import { eq, and, gte, lt, isNotNull, desc } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { dailyMissionLog, mockTests } from "../../../../db/schema.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";
import { loadPlanContext } from "../../../../lib/adaptive/planState.js";
import { buildFixedWeekPlan, dayNumberForDate, dateForDayNumber, TOTAL_FIXED_WEEK_DAYS } from "../../../../lib/adaptive/planEngine.js";
import { loadFixedWeekCompletion } from "../../../../lib/adaptive/onboardingWeekState.js";
import { loadPlayerState, XP_PER_MISSION } from "../../../../lib/gamification/missions.js";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const ctx = await loadPlanContext(userId);
    if (!ctx) return NextResponse.json({ error: "onboarding_not_complete" }, { status: 409 });
    if (!ctx.track) return NextResponse.json({ hasFixedWeek: false });

    const fixedWeek = buildFixedWeekPlan(ctx.subtopics, ctx.track, ctx.unlockedGsIds);
    if (!fixedWeek) return NextResponse.json({ hasFixedWeek: false });

    const todayDayNumber = dayNumberForDate(ctx.planStartDate, new Date());
    const learnDays = fixedWeek.days.filter((d) => d.type === "learn");
    const completionByDay = await loadFixedWeekCompletion(userId, ctx.planStartDate, learnDays);
    const daysCompleted = Object.values(completionByDay).filter((c) => c.complete).length;

    const weekStart = dateForDayNumber(ctx.planStartDate, 0);
    const weekEnd = dateForDayNumber(ctx.planStartDate, TOTAL_FIXED_WEEK_DAYS);
    const weekStartDate = weekStart.toISOString().slice(0, 10);
    const weekEndDate = weekEnd.toISOString().slice(0, 10);

    const missionRows = await db
      .select()
      .from(dailyMissionLog)
      .where(and(eq(dailyMissionLog.userId, userId), gte(dailyMissionLog.missionDate, weekStartDate), lt(dailyMissionLog.missionDate, weekEndDate)));

    const [weeklyTest] = await db
      .select({ totalScore: mockTests.totalScore, totalMarks: mockTests.totalMarks })
      .from(mockTests)
      .where(and(eq(mockTests.userId, userId), isNotNull(mockTests.totalScore), gte(mockTests.startedAt, weekStart), lt(mockTests.startedAt, weekEnd)))
      .orderBy(desc(mockTests.startedAt))
      .limit(1);
    const weeklyTestScorePct = weeklyTest && weeklyTest.totalMarks > 0 ? Math.round((weeklyTest.totalScore / weeklyTest.totalMarks) * 100) : null;

    const playerStateRow = await loadPlayerState(userId);

    return NextResponse.json({
      hasFixedWeek: true,
      eligible: todayDayNumber >= TOTAL_FIXED_WEEK_DAYS,
      track: ctx.track,
      daysCompleted,
      totalLearnDays: learnDays.length,
      missionsCompleted: missionRows.length,
      xpEarnedThisWeek: missionRows.length * XP_PER_MISSION,
      totalXp: playerStateRow.xp,
      currentStreakDays: playerStateRow.currentStreakDays,
      weeklyTestScorePct,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
