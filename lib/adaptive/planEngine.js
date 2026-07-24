// lib/adaptive/planEngine.js
//
// Piece B of the "1-year strategy" request: a day-wise tracker of topics to
// complete, tests to attempt, and revision to do. Pure, DB-free -- same
// discipline as lib/adaptive/unlocks.js/subjectUnlocks.js, independently
// testable with plain `node`. lib/adaptive/planState.js wraps this with the
// actual DB reads (subtopics, mastery, subject unlock timestamps).
//
// Explicitly COMPUTED, not AI-generated, per the user's own choice when this
// was scoped: a deterministic schedule built from data already tracked per
// subtopic (difficulty score, PYQ frequency, current mastery) plus each
// subject's real unlock timestamp (see lib/adaptive/subjectUnlocks.js) --
// nothing here calls the AI or invents content.
//
// Day numbers are 0-based, counting from the student's plan start date (the
// earliest subjectUnlocks.unlockedAt row -- see planStartDate in
// lib/adaptive/subjectUnlockState.js). "Day 0" is the day they onboarded.

import { ONBOARDING_WEEK_PLANS, FIXED_WEEK_LEARN_DAYS } from "../../db/seed/onboardingWeekPlans.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Day 0-6 for a student with an assigned onboarding track: days 0-4 are the
// fixed learn days, day 5 a test, day 6 a revise -- day 7 is where the
// normal computed engine takes back over (see TOTAL_FIXED_WEEK_DAYS below).
export const TOTAL_FIXED_WEEK_DAYS = FIXED_WEEK_LEARN_DAYS + 2;

export function dayNumberForDate(planStartDate, date) {
  return Math.floor((date.getTime() - planStartDate.getTime()) / MS_PER_DAY);
}

export function dateForDayNumber(planStartDate, dayNumber) {
  return new Date(planStartDate.getTime() + dayNumber * MS_PER_DAY);
}

// A simple weekly rhythm: 5 days learning new topics, 1 day testing what was
// learned that week, 1 day revising the weakest topics learned so far. Not
// tied to real weekdays -- "day 5" of the cycle is a test day whether that
// calendar date is a Saturday or a Tuesday, since the plan's own day-0 is
// whenever the student onboarded, not a fixed calendar anchor.
export const WEEK_CYCLE = ["learn", "learn", "learn", "learn", "learn", "test", "revise"];

export function dayType(dayNumber) {
  return WEEK_CYCLE[((dayNumber % WEEK_CYCLE.length) + WEEK_CYCLE.length) % WEEK_CYCLE.length];
}

// A content-heavy subtopic now spans MULTIPLE consecutive learn-days instead
// of being forced into one (2026-07-24 "rewrite Teach" change -- modules are
// treated like textbook chapters, studied across several days like a real
// NCERT chapter, not crammed into a single sitting). Actual generated module
// count isn't known at plan-computation time (modules are generated lazily,
// on first open), so this estimates study-days from pyqFrequency -- already
// available here -- as a proxy for how much real content a subtopic has.
// This replaces the old MAX_TOPICS_PER_LEARN_DAY=2 packing (2 subtopics
// interleaved per day) with sequential, chapter-by-chapter progression: one
// subtopic occupies its whole day-range before the next one starts.
const PYQS_PER_DAY_ESTIMATE = 3; // ~how many modules' Teach->Grasp->Remember->Test a day can hold
const MAX_DAYS_PER_SUBTOPIC = 5; // sanity ceiling -- one subtopic can't swallow the whole schedule
export function daysNeededForSubtopic(pyqFrequency) {
  return Math.min(MAX_DAYS_PER_SUBTOPIC, Math.max(1, Math.ceil((pyqFrequency || 0) / PYQS_PER_DAY_ESTIMATE)));
}

// Basics-first within a subject, higher-yield (more PYQ appearances) breaking
// ties -- same ordering convention as lib/adaptive/unlocks.js's
// orderSubtopicsWithinPaper, extended with availableFromDay as the primary
// key so a subject that unlocks later (GS III at day ~90, GS IV at ~180)
// naturally schedules later without the caller needing to filter it out.
function byScheduleOrder(a, b) {
  return (
    a.availableFromDay - b.availableFromDay ||
    a.difficultyScore - b.difficultyScore ||
    b.pyqFrequency - a.pyqFrequency ||
    a.id.localeCompare(b.id)
  );
}

/**
 * subtopics: [{ id, difficultyScore, pyqFrequency, availableFromDay }]
 * (availableFromDay = the day number its subject was/will be unlocked).
 * Returns Map<subtopicId, {startDay, endDay}> -- the consecutive learn-day
 * range each subtopic is scheduled across (endDay === startDay for a thin
 * subtopic needing just one day, same as the old single-day behavior).
 * Sequential: each subtopic in schedule order consumes
 * daysNeededForSubtopic(pyqFrequency) consecutive LEARN days (skipping over
 * test/revise days, which aren't for new-topic study) before the next
 * subtopic starts -- one subtopic actively being studied at a time, like
 * finishing one textbook chapter before starting the next.
 */
// startDay: the first day-slot allowed to be consumed -- 0 for the normal
// full pool, or 7 for the "day 7 onward" remainder pool when a fixed first
// week (see buildFixedWeekPlan below) has already claimed days 0-6.
export function assignLearningDays(subtopics, startDay = 0) {
  const queue = [...subtopics].sort(byScheduleOrder);
  const assignment = new Map();

  let day = startDay;
  for (const s of queue) {
    let d = Math.max(day, s.availableFromDay);
    while (dayType(d) !== "learn") d += 1;

    const startDay = d;
    const needed = daysNeededForSubtopic(s.pyqFrequency);
    let learnDaysConsumed = 1;
    let endDay = d;
    while (learnDaysConsumed < needed) {
      d += 1;
      if (dayType(d) === "learn") {
        learnDaysConsumed += 1;
        endDay = d;
      }
    }

    assignment.set(s.id, { startDay, endDay });
    day = endDay + 1;
  }
  return assignment;
}

export const REVISE_TOPICS_PER_DAY = 3;

/**
 * subtopics: [{ id, difficultyScore, pyqFrequency, availableFromDay,
 * masteryScore }]. Returns one entry per day in [fromDay, toDay]:
 * { day, type, subtopicIds }. "learn" days list topics newly scheduled that
 * day; "test" days list topics learned in the preceding 7 days (adaptive
 * practice already exists to serve the actual questions -- this just names
 * what to focus a practice session on); "revise" days list the
 * lowest-mastery topics learned so far, capped at REVISE_TOPICS_PER_DAY.
 */
export function buildDayPlan(subtopics, { fromDay, toDay, startDay = 0 }) {
  const learnDayBySubtopic = assignLearningDays(subtopics, startDay);

  const days = [];
  for (let day = fromDay; day <= toDay; day++) {
    const type = dayType(day);
    if (type === "learn") {
      // Range-aware (was a single `=== day` check) -- a multi-day subtopic
      // now appears on every day within its [startDay, endDay] span, not
      // just the first.
      const subtopicIds = subtopics
        .filter((s) => {
          const span = learnDayBySubtopic.get(s.id);
          return span != null && day >= span.startDay && day <= span.endDay;
        })
        .map((s) => s.id);
      days.push({ day, type, subtopicIds });
    } else if (type === "test") {
      const weekStart = day - 6;
      // A subtopic's span overlapping the trailing week counts as "learned
      // this week," even if it started before the week or hasn't finished
      // its full span yet -- same loose "worth testing on" semantics as
      // before, just range-aware instead of single-day.
      const subtopicIds = subtopics
        .filter((s) => {
          const span = learnDayBySubtopic.get(s.id);
          return span != null && span.startDay <= day && span.endDay >= weekStart;
        })
        .map((s) => s.id);
      days.push({ day, type, subtopicIds });
    } else {
      // "Learned so far" for revision purposes means STARTED (not
      // necessarily finished) -- even a partially-covered multi-day
      // subtopic already has modules worth revising.
      const learnedSoFar = subtopics.filter((s) => (learnDayBySubtopic.get(s.id)?.startDay ?? Infinity) <= day);
      const subtopicIds = [...learnedSoFar]
        .sort((a, b) => a.masteryScore - b.masteryScore)
        .slice(0, REVISE_TOPICS_PER_DAY)
        .map((s) => s.id);
      days.push({ day, type, subtopicIds });
    }
  }
  return { days, learnDayBySubtopic };
}

// Basics-first within a GS paper, same ordering byScheduleOrder uses for the
// ongoing plan -- deliberately NOT that function itself, since a fixed-week
// GS pool has no availableFromDay tiering to apply (both papers are already
// unlocked at onboarding).
function byGsOrder(a, b) {
  return a.difficultyScore - b.difficultyScore || b.pyqFrequency - a.pyqFrequency || a.id.localeCompare(b.id);
}

/**
 * The fixed, hand-curated first week (days 0-6) for a student's assigned
 * onboarding track (db/seed/placementQuiz.js / db/seed/onboardingWeekPlans.js).
 * Days 0-4 are that track's real PSIR subtopic ids plus GS "slot counts"
 * ({paper, count}) resolved here against gsIdsInOrder (the student's actual 2
 * chosen GS subject ids, in GS_UNLOCK_ORDER -- see
 * lib/adaptive/subjectUnlocks.js) by walking each paper's own
 * difficulty-ordered pool so a slice is never repeated across days. Day 5 is
 * a test over the whole week, day 6 a revise of its lowest-mastery topics --
 * the same "test the trailing week / revise weakest" semantics buildDayPlan
 * already uses, just scoped to only this fixed week's own content, not
 * hardcoded in onboardingWeekPlans.js.
 *
 * Returns null for a track with no fixed-week data (falls through to the
 * normal computed engine). A psir id absent from `subtopics` (e.g. the
 * student's optional isn't political-science-optional -- currently the only
 * seeded optional, so this shouldn't happen in practice) is silently
 * dropped rather than crashing.
 */
export function buildFixedWeekPlan(subtopics, track, gsIdsInOrder) {
  const weekPlan = ONBOARDING_WEEK_PLANS[track];
  if (!weekPlan) return null;

  const subtopicById = Object.fromEntries(subtopics.map((s) => [s.id, s]));
  const gsPoolByPaper = gsIdsInOrder.map((subjectId) => subtopics.filter((s) => s.subjectId === subjectId).sort(byGsOrder));
  const gsCursor = gsIdsInOrder.map(() => 0);

  const learnDayBySubtopic = new Map();
  const days = [];
  for (const entry of weekPlan) {
    const subtopicIds = entry.psir.filter((id) => subtopicById[id]);
    for (const slot of entry.gs) {
      const pool = gsPoolByPaper[slot.paper];
      if (!pool) continue;
      for (let i = 0; i < slot.count; i++) {
        const s = pool[gsCursor[slot.paper]];
        gsCursor[slot.paper] += 1;
        if (s) subtopicIds.push(s.id);
      }
    }
    for (const id of subtopicIds) learnDayBySubtopic.set(id, { startDay: entry.day, endDay: entry.day });
    days.push({ day: entry.day, type: "learn", subtopicIds });
  }

  const allIds = [...new Set(days.flatMap((d) => d.subtopicIds))];
  days.push({ day: FIXED_WEEK_LEARN_DAYS, type: "test", subtopicIds: allIds });

  const reviseIds = allIds
    .map((id) => subtopicById[id])
    .filter(Boolean)
    .sort((a, b) => a.masteryScore - b.masteryScore)
    .slice(0, REVISE_TOPICS_PER_DAY)
    .map((s) => s.id);
  days.push({ day: FIXED_WEEK_LEARN_DAYS + 1, type: "revise", subtopicIds: reviseIds });

  return { days, learnDayBySubtopic };
}
