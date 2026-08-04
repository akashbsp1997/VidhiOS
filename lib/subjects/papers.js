// lib/subjects/papers.js
//
// Static definition of every real UPSC CSE paper the top-level dashboard
// (app/page.jsx) enumerates as a tile -- independent of which ones actually
// have subtopics/content yet (see db/seed/subjects.js for the matching
// `subjects` rows, generated from this file's own data). A paper with zero
// subtopics renders as a "coming soon" tile rather than being hidden, per
// explicit product choice: the full exam structure should be visible now,
// real content added paper by paper later.
//
// GS papers, Essay, both qualifying-language choices, and both Prelims
// papers are each a single paper on their own (subtopics.paper is always 1
// for those, same as gs2's existing seed). Every optional subject genuinely
// splits into Paper VI / Paper VII, matching subtopics.paper's existing
// 1-or-2 semantics for law-optional's own syllabus (31 Paper I topics, 50
// Paper II topics).
//
// The 25 general optionals + 23 literature-of-language optionals (48 total)
// and the 22 Eighth-Schedule compulsory-language choices for Paper A are the
// REAL, complete official UPSC lists -- verified against two independent
// sources (2026-07-22), not guessed. Earlier revisions of this file only had
// Law and one generic "Literature" placeholder, and a single flat
// "Compulsory Indian Language" tile with no actual language choice -- both
// corrected here per explicit request. Generated programmatically from the
// name lists below rather than hand-enumerated, so there's one place to
// verify/update this data rather than ~140 hand-typed tile objects that
// could drift or contain a typo.
const GENERAL_OPTIONALS = [
  // Listed first -- this app's recommended/default optional (most fully
  // built out today: real syllabus, PYQs, and the fixed onboarding week are
  // all PSIR-based already, see db/seed/onboardingWeekPlans.js). Order here
  // drives both the dashboard tile order and getOptionalSubjects()' picker
  // order (app/onboarding/page.jsx, app/papers/optional/page.jsx).
  { subjectId: "political-science-optional", name: "Political Science and International Relations" },
  { subjectId: "law-optional", name: "Law" }, // pre-existing, has real content -- kept as-is, not regenerated
  { subjectId: "agriculture-optional", name: "Agriculture" },
  { subjectId: "animal-husbandry-optional", name: "Animal Husbandry and Veterinary Science" },
  { subjectId: "anthropology-optional", name: "Anthropology" },
  { subjectId: "botany-optional", name: "Botany" },
  { subjectId: "chemistry-optional", name: "Chemistry" },
  { subjectId: "civil-engineering-optional", name: "Civil Engineering" },
  { subjectId: "commerce-optional", name: "Commerce and Accountancy" },
  { subjectId: "economics-optional", name: "Economics" },
  { subjectId: "electrical-engineering-optional", name: "Electrical Engineering" },
  { subjectId: "geography-optional", name: "Geography" },
  { subjectId: "geology-optional", name: "Geology" },
  { subjectId: "history-optional", name: "History" },
  { subjectId: "management-optional", name: "Management" },
  { subjectId: "mathematics-optional", name: "Mathematics" },
  { subjectId: "mechanical-engineering-optional", name: "Mechanical Engineering" },
  { subjectId: "medical-science-optional", name: "Medical Science" },
  { subjectId: "philosophy-optional", name: "Philosophy" },
  { subjectId: "physics-optional", name: "Physics" },
  { subjectId: "psychology-optional", name: "Psychology" },
  { subjectId: "public-administration-optional", name: "Public Administration" },
  { subjectId: "sociology-optional", name: "Sociology" },
  { subjectId: "statistics-optional", name: "Statistics" },
  { subjectId: "zoology-optional", name: "Zoology" },
];

// Literature-of-language optionals -- 22 Eighth Schedule languages plus
// English (English Literature is a real 23rd choice here, distinct from
// Paper B "English Language" below, which is qualifying-only and has no
// literature content).
const LITERATURE_LANGUAGES = [
  "Assamese", "Bengali", "Bodo", "Dogri", "Gujarati", "Hindi", "Kannada", "Kashmiri", "Konkani",
  "Maithili", "Malayalam", "Manipuri", "Marathi", "Nepali", "Odia", "Punjabi", "Sanskrit",
  "Santali", "Sindhi", "Tamil", "Telugu", "Urdu", "English",
];

// Paper A's 22 Eighth-Schedule choices -- English is deliberately excluded
// (that's the separate, fixed Paper B "English Language" below, not a
// Paper A option).
const COMPULSORY_LANGUAGES = [
  "Assamese", "Bengali", "Bodo", "Dogri", "Gujarati", "Hindi", "Kannada", "Kashmiri", "Konkani",
  "Maithili", "Malayalam", "Manipuri", "Marathi", "Nepali", "Odia", "Punjabi", "Sanskrit",
  "Santali", "Sindhi", "Tamil", "Telugu", "Urdu",
];

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const optionalPaperTiles = GENERAL_OPTIONALS.flatMap(({ subjectId, name }) => [
  { group: `CSE Mains — Merit — Optional: ${name}`, subjectId, paper: 1, label: "Paper VI: Optional Paper 1", marks: 250 },
  { group: `CSE Mains — Merit — Optional: ${name}`, subjectId, paper: 2, label: "Paper VII: Optional Paper 2", marks: 250 },
]);

const literaturePaperTiles = LITERATURE_LANGUAGES.flatMap((lang) => {
  const subjectId = `${slugify(lang)}-literature-optional`;
  const name = `${lang} Literature`;
  return [
    { group: `CSE Mains — Merit — Optional: ${name}`, subjectId, paper: 1, label: "Paper VI: Optional Paper 1", marks: 250 },
    { group: `CSE Mains — Merit — Optional: ${name}`, subjectId, paper: 2, label: "Paper VII: Optional Paper 2", marks: 250 },
  ];
});

const compulsoryLanguageTiles = COMPULSORY_LANGUAGES.map((lang) => ({
  group: `CSE Mains — Qualifying — Compulsory Language: ${lang}`,
  subjectId: `${slugify(lang)}-compulsory-language`,
  paper: 1,
  label: `Paper A: ${lang}`,
  marks: 300,
  qualifying: true,
}));

// Pure data, DB-free -- safe to import from a client component (app/page.jsx
// and the various app/papers/** pages) as well as a server route
// (app/api/papers/route.js), same house convention as lib/adaptive/unlocks.js.
export const PAPER_TILES = [
  { group: "CSE Prelims", subjectId: "prelims-gs", paper: 1, label: "General Studies" },
  { group: "CSE Prelims", subjectId: "prelims-csat", paper: 1, label: "CSAT (Quant)" },

  // Qualifying only -- NOT counted toward final merit ranking. A minimum
  // 25% in EACH is required before the merit-based papers below are even
  // evaluated. Paper A's language choice is a picker (compulsoryLanguageTiles,
  // 22 real options); Paper B is fixed (English only, no choice).
  ...compulsoryLanguageTiles,
  { group: "CSE Mains — Qualifying", subjectId: "english-qualifying", paper: 1, label: "Paper B: English Language", marks: 300, qualifying: true },

  // Merit-based -- counted for final ranking, official Paper I-VII numbering.
  { group: "CSE Mains — Merit", subjectId: "essay", paper: 1, label: "Paper I: Essay", marks: 250 },
  { group: "CSE Mains — Merit", subjectId: "gs1", paper: 1, label: "Paper II: GS I", marks: 250 },
  { group: "CSE Mains — Merit", subjectId: "gs2", paper: 1, label: "Paper III: GS II", marks: 250 },
  { group: "CSE Mains — Merit", subjectId: "gs3", paper: 1, label: "Paper IV: GS III", marks: 250 },
  { group: "CSE Mains — Merit", subjectId: "gs4", paper: 1, label: "Paper V: GS IV", marks: 250 },

  ...optionalPaperTiles,
  ...literaturePaperTiles,
];

export function findPaperTile(subjectId, paper) {
  return PAPER_TILES.find((t) => t.subjectId === subjectId && t.paper === paper) || null;
}

function taggedGroupName(group, marker) {
  const match = group.match(new RegExp(`${marker}: (.+)$`));
  return match ? match[1] : null;
}

export function isOptionalTile(tile) {
  return taggedGroupName(tile.group, "Optional") !== null;
}

export function isCompulsoryLanguageTile(tile) {
  return taggedGroupName(tile.group, "Compulsory Language") !== null;
}

/**
 * The distinct list of optional subjects (25 general + 23 literature = 48)
 * for the "choose your optional" selection page
 * (app/papers/optional/page.jsx) -- one entry per subjectId, not per paper
 * tile. Order follows PAPER_TILES' own order.
 */
export function getOptionalSubjects() {
  const seen = new Map();
  for (const t of PAPER_TILES) {
    const displayName = taggedGroupName(t.group, "Optional");
    if (displayName && !seen.has(t.subjectId)) seen.set(t.subjectId, { subjectId: t.subjectId, displayName });
  }
  return [...seen.values()];
}

/** Both paper tiles for one chosen optional subject (app/papers/optional/[subjectId]/page.jsx). */
export function getOptionalSubjectPapers(subjectId) {
  return PAPER_TILES.filter((t) => t.subjectId === subjectId && isOptionalTile(t));
}

/**
 * The distinct list of Paper A language choices (22) for
 * app/papers/language/page.jsx. Each has exactly one paper tile (paper: 1)
 * -- unlike an optional subject, there's no "both papers" intermediate step,
 * a picked language links straight to its subtopics page.
 */
export function getCompulsoryLanguages() {
  const seen = new Map();
  for (const t of PAPER_TILES) {
    const displayName = taggedGroupName(t.group, "Compulsory Language");
    if (displayName && !seen.has(t.subjectId)) seen.set(t.subjectId, { subjectId: t.subjectId, displayName });
  }
  return [...seen.values()];
}
