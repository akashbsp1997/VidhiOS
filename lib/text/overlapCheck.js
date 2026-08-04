// lib/text/overlapCheck.js
//
// Detects whether one text verbatim-restates a run of words from another --
// used to catch a generated Teach explanation that quotes/restates its
// anchor PYQ question instead of teaching the underlying concept (see
// lib/ai/generateModules.js's buildModuleTeachUserPrompt anchor clause,
// which only ASKS the model not to do this -- nothing previously checked
// whether it actually complied). A generous n-gram threshold (8+
// consecutive shared words, not any single phrase) so a genuinely short,
// common term ("Article 21") appearing naturally inside a thorough
// explanation is never flagged as a leak.

const MIN_OVERLAP_WORDS = 8;

function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True if `text` contains a run of MIN_OVERLAP_WORDS+ consecutive words that
 * also appear, in the same order, as a consecutive run inside `question`.
 * Exact, order-preserving substring matching on normalized word sequences --
 * not a general plagiarism/similarity detector, just enough to catch a
 * model literally echoing the question's own phrasing.
 */
export function containsVerbatimQuestion(text, question) {
  if (!text || !question) return false;
  const textJoined = ` ${normalizeWords(text).join(" ")} `;
  const qWords = normalizeWords(question);
  if (qWords.length < MIN_OVERLAP_WORDS) return false;

  for (let i = 0; i + MIN_OVERLAP_WORDS <= qWords.length; i++) {
    const gram = qWords.slice(i, i + MIN_OVERLAP_WORDS).join(" ");
    if (textJoined.includes(` ${gram} `)) return true;
  }
  return false;
}
