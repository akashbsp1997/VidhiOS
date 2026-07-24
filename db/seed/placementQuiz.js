// db/seed/placementQuiz.js
//
// Fixed, hand-authored placement quiz shown once at onboarding (mandatory,
// not self-select -- see app/onboarding/page.jsx) to assign a new student to
// one of 4 preloaded 7-day difficulty tracks (db/seed/onboardingWeekPlans.js).
// Deliberately NOT AI-graded -- this needs to be instant at onboarding, and
// deterministic point-scoring is more than accurate enough for a coarse
// 4-bucket placement. Two of the seven questions are real, easy factual
// checks (one PSIR, one GS Polity); the rest are honest self-report about
// prior exposure, comfort, and available time -- all of which genuinely
// predict how much a brand-new student can handle in week 1, not just raw
// knowledge.
//
// Every question is worth 0-3 points except the two factual checks (0 or 2,
// right/wrong) -- max total 19. See TRACK_BY_SCORE below for the buckets.

export const PLACEMENT_QUIZ_QUESTIONS = [
  {
    id: "prior-exposure",
    text: "Have you studied Political Science, Public Administration, or a related social-science subject formally (school/college major, or coaching)?",
    options: [
      { label: "No, never", points: 0 },
      { label: "A little, in school", points: 1 },
      { label: "Yes, as a college subject", points: 2 },
      { label: "Yes, extensively (a degree or serious coaching)", points: 3 },
    ],
  },
  {
    id: "writing-comfort",
    text: "How comfortable are you writing a 200-300 word analytical answer in English on a topic you've just read about?",
    options: [
      { label: "Not comfortable at all", points: 0 },
      { label: "A bit shaky", points: 1 },
      { label: "Reasonably comfortable", points: 2 },
      { label: "Very comfortable", points: 3 },
    ],
  },
  {
    id: "prep-months",
    text: "How many months have you already spent preparing for UPSC (any subject)?",
    options: [
      { label: "None, just starting", points: 0 },
      { label: "Less than 6 months", points: 1 },
      { label: "6-12 months", points: 2 },
      { label: "More than a year", points: 3 },
    ],
  },
  {
    id: "daily-hours",
    text: "How many hours per day can you consistently dedicate to study?",
    options: [
      { label: "Less than 1 hour", points: 0 },
      { label: "1-2 hours", points: 1 },
      { label: "3-4 hours", points: 2 },
      { label: "5+ hours", points: 3 },
    ],
  },
  {
    id: "exam-familiarity",
    text: "How familiar are you with the UPSC exam pattern (Prelims, Mains, Interview structure)?",
    options: [
      { label: "No idea", points: 0 },
      { label: "Heard the basics", points: 1 },
      { label: "Understand it reasonably well", points: 2 },
      { label: "Very familiar", points: 3 },
    ],
  },
  {
    id: "check-psir",
    text: "Quick check: whose idea is the classical \"social contract\" most associated with (Hobbes, Locke, Rousseau)?",
    options: [
      { label: "All three, among others -- it's a foundational idea in political theory they each developed differently", points: 2 },
      { label: "Only Karl Marx", points: 0 },
      { label: "It's a modern Indian constitutional concept, not a Western one", points: 0 },
      { label: "I'm not sure", points: 0 },
    ],
  },
  {
    id: "check-polity",
    text: "Quick check: who is commonly called the \"Father of the Indian Constitution\"?",
    options: [
      { label: "B.R. Ambedkar", points: 2 },
      { label: "Mahatma Gandhi", points: 0 },
      { label: "Jawaharlal Nehru", points: 0 },
      { label: "I'm not sure", points: 0 },
    ],
  },
];

export const MAX_PLACEMENT_SCORE = PLACEMENT_QUIZ_QUESTIONS.reduce(
  (sum, q) => sum + Math.max(...q.options.map((o) => o.points)),
  0
); // 19

export const TRACKS = ["starting_out", "beginner", "advanced", "fastforward"];

export function scoreToTrack(totalPoints) {
  if (totalPoints <= 4) return "starting_out";
  if (totalPoints <= 9) return "beginner";
  if (totalPoints <= 14) return "advanced";
  return "fastforward";
}
