// db/seed/onboardingWeekPlans.js
//
// Fixed (not computed) 7-day curriculum for a new student's first week,
// keyed by the track their placement quiz assigned (db/seed/placementQuiz.js).
// Days 0-4 are hand-picked real PSIR subtopics (db/seed/political-science-syllabus.js
// -- basics-first: Political Theory fundamentals before Indian Government/
// IR/India-and-the-World) plus a count of GS subtopics to pull from each of
// the student's 2 chosen GS papers that day, resolved dynamically at serve
// time (lib/adaptive/planState.js) using the SAME real difficulty-score
// ordering the rest of the app already uses (lib/adaptive/unlocks.js) --
// this file only fixes PSIR (always the same optional) and how many GS
// subtopics per day, never which specific GS subtopic (that depends on
// which 2 papers the student picked at onboarding).
//
// `gs: [{ paper, count }]` -- `paper` is 0 or 1, indexing into the student's
// 2 chosen GS subject ids in GS_UNLOCK_ORDER order (see
// lib/adaptive/subjectUnlocks.js), not a specific subject id, since the
// pair varies per student. Day 5 (test) and day 6 (revise) are NOT listed
// here -- they're computed generically from whatever days 0-4 assigned, the
// same "test the trailing week / revise lowest mastery" logic
// lib/adaptive/planEngine.js's buildDayPlan already uses for the ongoing
// plan, just scoped to this fixed week's own content.
//
// Daily new-subtopic count increases by track: starting_out stays at 1-2 a
// day (deliberately light, habit-forming); fastforward runs 3-4 a day,
// weighted toward PSIR's higher-pyqFrequency subtopics.
export const ONBOARDING_WEEK_PLANS = {
  starting_out: [
    { day: 0, psir: ["psir-pt1"], gs: [{ paper: 0, count: 1 }] },
    { day: 1, psir: [], gs: [{ paper: 1, count: 1 }] },
    { day: 2, psir: ["psir-pt6"], gs: [] },
    { day: 3, psir: [], gs: [{ paper: 0, count: 1 }] },
    { day: 4, psir: ["psir-pt5"], gs: [{ paper: 1, count: 1 }] },
  ],
  beginner: [
    { day: 0, psir: ["psir-pt1"], gs: [{ paper: 0, count: 1 }] },
    { day: 1, psir: ["psir-pt2"], gs: [{ paper: 1, count: 1 }] },
    { day: 2, psir: ["psir-pt6"], gs: [{ paper: 0, count: 1 }] },
    { day: 3, psir: ["psir-pt7"], gs: [{ paper: 1, count: 1 }] },
    { day: 4, psir: ["psir-igp3"], gs: [] },
  ],
  advanced: [
    { day: 0, psir: ["psir-pt1", "psir-pt2"], gs: [{ paper: 0, count: 1 }] },
    { day: 1, psir: ["psir-pt6", "psir-pt7"], gs: [{ paper: 1, count: 1 }] },
    { day: 2, psir: ["psir-pt9", "psir-pt10"], gs: [{ paper: 0, count: 1 }] },
    { day: 3, psir: ["psir-igp2", "psir-igp3"], gs: [{ paper: 1, count: 1 }] },
    { day: 4, psir: ["psir-ir1"], gs: [{ paper: 0, count: 1 }, { paper: 1, count: 1 }] },
  ],
  fastforward: [
    { day: 0, psir: ["psir-pt1", "psir-pt9", "psir-pt10"], gs: [{ paper: 0, count: 1 }, { paper: 1, count: 1 }] },
    { day: 1, psir: ["psir-igp3", "psir-igp10"], gs: [{ paper: 0, count: 1 }, { paper: 1, count: 1 }] },
    { day: 2, psir: ["psir-pt7", "psir-pt8", "psir-igp6"], gs: [{ paper: 0, count: 1 }] },
    { day: 3, psir: ["psir-igp9", "psir-igp12", "psir-ir6"], gs: [{ paper: 1, count: 1 }] },
    { day: 4, psir: ["psir-iw1", "psir-iw4", "psir-iw9"], gs: [{ paper: 0, count: 1 }, { paper: 1, count: 1 }] },
  ],
};

export const FIXED_WEEK_LEARN_DAYS = 5; // days 0-4; day 5 = test, day 6 = revise
