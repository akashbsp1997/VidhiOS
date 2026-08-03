// lib/ingest/sourceLibrary.js
//
// A curated list of real, publicly-hosted primary-source documents for
// app/api/setup/backfill-source-library to pull in via the same
// fetch-archive-extract path app/api/ingest/fetch-url uses for a single
// operator-submitted URL (lib/ingest/fetchUrlUpload.js) -- the Constitution
// of India plus NCERT textbook chapters covering the GS1/GS2/GS3 syllabus
// at chapter granularity, so Teach/Plan/question generation has real
// primary-source text to ground in instead of relying on the model's own
// recall.
//
// ncert.nic.in itself resets/refuses connections from outside India
// (verified live, 2026-07-27, from this app's own build/deploy network) --
// these NCERT entries instead point at archive.org's item-per-book mirrors
// (https://archive.org/details/ncert-<bookCode>), which serve the exact
// same official NCERT PDFs (verified: real text-layer PDFs with a working
// pdf-parse extraction, not scans) and are reachable from anywhere,
// including Vercel. If archive.org ever removes one of these, that single
// item just errors out in the run's per-item log (see the route) --
// nothing else in the list is affected.

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

function ncertChapterEntries({ bookCode, subjectId, label, chapters }) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return chapters.map((ch) => ({
    url: `https://archive.org/download/ncert-${bookCode}/${bookCode}${pad2(ch)}.pdf`,
    docType: "ncert_chapter",
    subjectId,
    label: `${label}, Ch. ${ch}`,
  }));
}

// subjectId assignment follows this app's actual GS paper split (see
// db/seed/subjects.js): GS1 = history/geography/society, GS2 =
// polity/governance/constitution/IR, GS3 = economy. Book-to-subject mapping
// is by the book's dominant theme, same as how an operator would tag it by
// hand in the Ingest Upload UI.
const NCERT_BOOKS = [
  { bookCode: "keps1", subjectId: "gs2", label: "NCERT Class 11 Political Science -- Political Theory", chapters: range(1, 10) },
  { bookCode: "keps2", subjectId: "gs2", label: "NCERT Class 11 Political Science -- Indian Constitution at Work", chapters: range(1, 10) },
  { bookCode: "leps1", subjectId: "gs2", label: "NCERT Class 12 Political Science -- Contemporary World Politics", chapters: range(1, 9) },
  { bookCode: "leps2", subjectId: "gs2", label: "NCERT Class 12 Political Science -- Politics in India Since Independence", chapters: range(1, 9) },
  { bookCode: "keec1", subjectId: "gs3", label: "NCERT Class 11 Economics -- Indian Economic Development", chapters: range(1, 3) },
  { bookCode: "leec1", subjectId: "gs3", label: "NCERT Class 12 Economics -- Introductory Macroeconomics", chapters: range(1, 2) },
  { bookCode: "leec2", subjectId: "gs3", label: "NCERT Class 12 Economics -- Introductory Microeconomics", chapters: range(1, 4) },
  // Chapter 6 doesn't exist as a separate PDF in the source archive for this
  // book (front matter absorbs it) -- 1,2,3,4,5,7 is the real chapter set.
  { bookCode: "kegy1", subjectId: "gs1", label: "NCERT Class 11 Geography -- India: Physical Environment", chapters: [1, 2, 3, 4, 5, 7] },
  { bookCode: "kegy2", subjectId: "gs1", label: "NCERT Class 11 Geography -- Fundamentals of Physical Geography", chapters: range(1, 16) },
  { bookCode: "legy1", subjectId: "gs1", label: "NCERT Class 12 Geography -- Fundamentals of Human Geography", chapters: range(1, 10) },
  { bookCode: "legy2", subjectId: "gs1", label: "NCERT Class 12 Geography -- India: People and Economy", chapters: range(1, 12) },
  { bookCode: "kehs1", subjectId: "gs1", label: "NCERT Class 11 History -- Themes in World History", chapters: range(1, 11) },
  { bookCode: "lehs1", subjectId: "gs1", label: "NCERT Class 12 History -- Themes in Indian History I", chapters: range(1, 4) },
  { bookCode: "lehs2", subjectId: "gs1", label: "NCERT Class 12 History -- Themes in Indian History II", chapters: range(1, 5) },
  { bookCode: "lehs3", subjectId: "gs1", label: "NCERT Class 12 History -- Themes in Indian History III", chapters: range(1, 6) },
];

export const SOURCE_LIBRARY = [
  {
    url: "https://www.indiacode.nic.in/bitstream/123456789/19150/1/constitution_of_india.pdf",
    docType: "external_source",
    subjectId: "gs2",
    label: "The Constitution of India (Ministry of Law and Justice, India Code)",
  },
  ...NCERT_BOOKS.flatMap(ncertChapterEntries),
];
