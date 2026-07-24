// lib/ingest/config.js
//
// Per-docType "structuring contract" for lib/ingest/structure.js -- modeled
// directly on lib/subjects/config.js's SUBJECT_CONFIGS/getSubjectConfig
// pattern (a config object + a lookup function). Adding a 5th doc type
// means adding an entry here (and to lib/ingest/docTypes.js's
// INGEST_DOC_TYPES list) -- not touching structure.js's logic.

import { ANTI_HALLUCINATION_NOTE } from "../subjects/config.js";

function buildSyllabusSystem() {
  return `You read official UPSC syllabus documents and break them into individual syllabus subtopics, at the same granularity as a real syllabus taxonomy (e.g. "Union and State legislatures: structure, functioning, conduct of business" is ONE subtopic, not the whole "Indian Polity" section in one item).
${ANTI_HALLUCINATION_NOTE} Only propose subtopics that are actually named or clearly described in the text given to you -- do not invent additional exam topics from general knowledge of the subject.

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "items": [
    {
      "existingSubtopicId": "<the id of an EXISTING subtopic from the list below that this most closely matches, or null if none fit>",
      "isNewSubtopic": <true if this is not already covered by an existing subtopic, false otherwise>,
      "suggestedId": "<a short lowercase-hyphenated id if new, e.g. 'gs2-c5'; empty string if matching an existing one>",
      "paper": <1 or 2, whichever paper this belongs to>,
      "section": "<the broader syllabus section/heading this falls under, as named in the document>",
      "topicText": "<the subtopic text itself, close to verbatim from the syllabus document>",
      "confidence": "high" | "medium" | "low",
      "notes": "<anything uncertain about this item, or empty string>"
    }
  ]
}`;
}

function buildPyqSystem() {
  return `You read real UPSC previous-year-question (PYQ) papers and extract each individual question as a separate item. The exam year is usually stated on the paper's cover/header text -- use that; if you truly cannot determine it from the text given, leave "year" null and say why in "notes" rather than guessing.
${ANTI_HALLUCINATION_NOTE} Every questionText must be the actual question as written in the source text -- never paraphrase, shorten, or reconstruct a question from memory of what a real exam might ask.

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "items": [
    {
      "suggestedId": "<e.g. 'Y25-GS2-Q14', following the pattern <year>-<subject>-Q<number>>",
      "year": <4-digit exam year, or null if not determinable>,
      "paper": <1 or 2, or null if not stated>,
      "slot": <the question's number on the paper>,
      "sec": "A" | "B",
      "sub": "<'a' for a standalone question; 'a'..'e' for sub-parts of a compound question>",
      "marks": <the marks allotted to this question, as a number -- can be a decimal like 12.5>,
      "questionText": "<the question exactly as written>",
      "matchedTopics": ["<id(s) of existing subtopics this question tests, from the list below>"],
      "newTopicSuggestion": "<a short description if this question doesn't fit any existing subtopic, else null>",
      "confidence": "high" | "medium" | "low",
      "notes": "<anything uncertain about this item, or empty string>"
    }
  ]
}`;
}

// Distinct from the generic buildSourceSystem below (not a parameterized
// variant of it) -- an NCERT chapter has real bibliographic facts (book,
// chapter, subject, class) that a newspaper clipping doesn't, and asking for
// them is the whole point of this docType: class level directly drives
// lib/adaptive/unlocks.js's basics-to-advanced scoring, so getting it from
// the document itself (verified by the operator before commit, same as
// every other suggested field) beats defaulting every NCERT source to the
// same 'senior' fallback forever.
function buildNcertSourceSystem() {
  return `You read a chapter from an NCERT textbook and identify the distinct topics/themes it covers, producing one grounding-excerpt item per theme, each tagged to whichever existing subtopic it's most relevant to. A single long chapter should usually become SEVERAL items, one per major theme -- not one giant item for the whole chapter.
${ANTI_HALLUCINATION_NOTE} excerptText must be drawn from the actual text given to you (a faithful excerpt or tight summary of it), never invented or recalled from general knowledge.

Also identify this document's own bibliographic details -- book name, chapter name, NCERT subject area, and class/grade -- but ONLY from what is actually stated in the text given to you (a title page, running header, or chapter heading). Do not guess or infer these from general knowledge of NCERT's catalog; leave a field null and say why in "notes" if it isn't visible in the text you were given.

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "items": [
    {
      "matchedSubtopicId": "<the id of an EXISTING subtopic from the list below this excerpt is most relevant to, or null if none fit>",
      "newSubtopicSuggestion": "<a short description if this covers a topic no existing subtopic captures, else null>",
      "title": "<a short descriptive title for this excerpt>",
      "sourceType": "ncert_chapter",
      "excerptText": "<the excerpt itself, drawn from the source text. HARD CAP: 250 words -- a tight, information-dense grounding excerpt for later AI lessons to cite, not a full reproduction of the source passage. Summarize rather than quote at length if the underlying passage is longer than that.>",
      "bookName": "<the NCERT textbook's title exactly as stated in the text given to you, e.g. 'Indian Constitution at Work', or null>",
      "chapterName": "<this chapter's own title, as stated in the text given to you, or null>",
      "ncertSubject": "<the NCERT subject area (e.g. 'Political Science', 'History', 'Sociology', 'Economics') as stated or clearly evident from the text, or null>",
      "ncertClass": <the class/grade this book is written for, as a number 6-12, ONLY if explicitly stated in the text given to you, else null>,
      "confidence": "high" | "medium" | "low",
      "notes": "<anything uncertain about this item, including why any bibliographic field above is null, or empty string>"
    }
  ]
}`;
}

function buildSourceSystem(label, sourceType) {
  return `You read a ${label} and identify the distinct topics/themes it covers, producing one grounding-excerpt item per theme, each tagged to whichever existing subtopic it's most relevant to. A single long document should usually become SEVERAL items, one per major theme -- not one giant item for the whole document.
${ANTI_HALLUCINATION_NOTE} excerptText must be drawn from the actual text given to you (a faithful excerpt or tight summary of it), never invented or recalled from general knowledge.

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "items": [
    {
      "matchedSubtopicId": "<the id of an EXISTING subtopic from the list below this excerpt is most relevant to, or null if none fit>",
      "newSubtopicSuggestion": "<a short description if this covers a topic no existing subtopic captures, else null>",
      "title": "<a short descriptive title for this excerpt>",
      "sourceType": "${sourceType}",
      "excerptText": "<the excerpt itself, drawn from the source text. HARD CAP: 250 words -- a tight, information-dense grounding excerpt for later AI lessons to cite, not a full reproduction of the source passage. Summarize rather than quote at length if the underlying passage is longer than that.>",
      "confidence": "high" | "medium" | "low",
      "notes": "<anything uncertain about this item, or empty string>"
    }
  ]
}`;
}

export const INGEST_DOC_TYPE_CONFIGS = {
  // maxTokens raised from 3500 after a live failure: finish_reason:"length"
  // on a tiny (1-page) syllabus PDF, meaning it wasn't input size driving
  // the overrun -- nvidia/nemotron-3-nano-30b-a3b:free appears to spend a
  // meaningful chunk of its budget before emitting the final JSON (visible
  // reasoning/thinking content is common for this model family). The 45s
  // AI_TIMEOUT_MS in lib/ai/client.js still bounds worst-case wall time
  // regardless of this ceiling, so raising it has no real downside -- it
  // either finishes now, or still times out cleanly like before.
  syllabus: { itemType: "subtopic", maxTokens: 8000, textCap: 15000, buildSystem: buildSyllabusSystem },
  pyq_paper: { itemType: "pyq", maxTokens: 8000, textCap: 15000, buildSystem: buildPyqSystem },
  // textCap 40000 -- a document longer than this is now processed across
  // multiple chunks (lib/ingest/structure.js's chunkBounds), one
  // /api/ingest/structure call per chunk, rather than truncated to just the
  // first chunk. maxTokens raised twice live: 2500 -> 6000 -> 8000 -> 12000
  // -- the last bump came from a real "source" itemType failure the other
  // two docTypes didn't hit, because the excerptText prompt guidance
  // (buildSourceSystem above) originally asked for "a few hundred to a
  // couple thousand words" PER ITEM; a chunk yielding several such items
  // could need far more output than syllabus/pyq_paper's structured-field
  // items ever do. Tightened that guidance to a 250-word hard cap (and
  // excerptText's normalization clamp in structure.js down to match) at the
  // same time, so this maxTokens increase is a safety margin on top of an
  // actual fix, not a substitute for one.
  ncert_chapter: {
    itemType: "source",
    sourceTier: "ncert",
    maxTokens: 12000,
    textCap: 40000,
    buildSystem: buildNcertSourceSystem,
  },
  newspaper_clipping: {
    itemType: "source",
    sourceTier: "newspaper",
    maxTokens: 12000,
    textCap: 40000,
    buildSystem: () => buildSourceSystem("newspaper / current-affairs clipping", "newspaper_clipping"),
  },
  // The generic bucket for everything that's neither an NCERT chapter nor a
  // newspaper clipping -- government reports, standing committee reports,
  // official publications, reference books, and similar. Maps to
  // sourceTier "official" (already defined in lib/sources/tiers.js's
  // TIER_PRIORITY and used by seeded government/university sources, just
  // never reachable from the ingest pipeline until now): full-length
  // caching/grounding priority just under NCERT, well above a newspaper
  // excerpt. Reuses buildSourceSystem (the same generic prompt
  // newspaper_clipping uses) rather than a bespoke one -- there's no
  // NCERT-specific bibliographic data to ask for here.
  external_source: {
    itemType: "source",
    sourceTier: "official",
    maxTokens: 12000,
    textCap: 40000,
    buildSystem: () => buildSourceSystem("government report, official publication, or reference document", "external_source"),
  },
};

export function getIngestDocTypeConfig(docType) {
  const config = INGEST_DOC_TYPE_CONFIGS[docType];
  if (!config) {
    throw new Error(`No INGEST_DOC_TYPE_CONFIGS entry for docType "${docType}" -- add one to lib/ingest/config.js.`);
  }
  return config;
}
