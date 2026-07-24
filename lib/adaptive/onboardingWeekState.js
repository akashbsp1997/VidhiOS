// lib/adaptive/onboardingWeekState.js
//
// The "write your answer" completion check for Part E2's fixed 7-day
// onboarding week -- a day counts complete once every subtopic it required
// has at least one attempts row (POST /api/attempt, the same save-only flow
// PracticeSession.jsx already uses everywhere else) created within that
// day's calendar window. Derived entirely from the existing attempts table,
// same as missions/streaks are reconstructed rather than duplicated into a
// new column.

import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "../db.js";
import { attempts } from "../../db/schema.js";
import { dateForDayNumber } from "./planEngine.js";

/**
 * learnDays: [{ day, subtopicIds }] -- the fixed week's own learn days
 * (see buildFixedWeekPlan). Returns
 * Map<day, { answeredSubtopicIds: string[], complete: boolean }>.
 * `complete` is false for a day with zero required subtopics too (nothing
 * to write, shouldn't happen given onboardingWeekPlans.js always assigns
 * at least one GS or PSIR subtopic per day, but kept honest rather than
 * vacuously true).
 */
export async function loadFixedWeekCompletion(userId, planStartDate, learnDays) {
  const result = {};
  const allSubtopicIds = [...new Set(learnDays.flatMap((d) => d.subtopicIds))];
  if (!allSubtopicIds.length) return result;

  const windowStart = dateForDayNumber(planStartDate, learnDays[0].day);
  const windowEnd = dateForDayNumber(planStartDate, learnDays[learnDays.length - 1].day + 1);

  const rows = await db
    .select({ subtopicId: attempts.subtopicId, createdAt: attempts.createdAt })
    .from(attempts)
    .where(and(eq(attempts.userId, userId), inArray(attempts.subtopicId, allSubtopicIds), gte(attempts.createdAt, windowStart), lt(attempts.createdAt, windowEnd)));

  for (const d of learnDays) {
    const dayStart = dateForDayNumber(planStartDate, d.day);
    const dayEnd = dateForDayNumber(planStartDate, d.day + 1);
    const answeredIds = new Set(
      rows.filter((r) => d.subtopicIds.includes(r.subtopicId) && r.createdAt >= dayStart && r.createdAt < dayEnd).map((r) => r.subtopicId)
    );
    result[d.day] = {
      answeredSubtopicIds: [...answeredIds],
      complete: d.subtopicIds.length > 0 && d.subtopicIds.every((id) => answeredIds.has(id)),
    };
  }
  return result;
}
