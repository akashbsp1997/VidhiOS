// lib/legal/forumRecommend.js
//
// Deterministic, rule-based forum/court recommendation -- NOT an AI call.
// Forum selection is exactly the kind of decision where a plausible-sounding
// but wrong AI guess (the wrong forum has real consequences: limitation
// periods, refiling costs) is worse than a transparent, inspectable rule.
// This scores every row already in the legalForums catalog (db/seed/
// legal-forums.js) against the case's own facts and returns a ranked list
// with the exact reasons behind each score, so a user can see WHY something
// was suggested rather than trusting a black box.

const CASE_TYPE_MATCH_SCORE = 40;
const SUBJECT_TAG_MATCH_SCORE = 25;
const PECUNIARY_FIT_SCORE = 20;
const PECUNIARY_UNKNOWN_PENALTY = 5; // small nudge down when the claim amount can't be checked at all, so a fully-verified fit still ranks above a same-scoring guess

function normalizeTag(s) {
  return (s || "").toLowerCase().trim();
}

/**
 * Loose word-overlap match between a case's free-text subjectMatter and a
 * forum's subjectTags -- deliberately simple (substring/word containment,
 * no fuzzy matching or synonyms) so the reasons stay explainable: either a
 * tag word appears in the case's own text or it doesn't.
 */
function subjectMatches(subjectMatter, subjectTags) {
  const text = normalizeTag(subjectMatter);
  if (!text || !subjectTags?.length) return [];
  return subjectTags.filter((tag) => {
    const t = normalizeTag(tag);
    return t && (text.includes(t) || t.includes(text));
  });
}

function pecuniaryFit(claimAmount, pecuniaryMin, pecuniaryMax) {
  if (claimAmount == null) return { fits: null }; // unknown -- can't evaluate
  const min = pecuniaryMin ?? 0;
  const max = pecuniaryMax ?? Infinity;
  return { fits: claimAmount >= min && claimAmount <= max, min, max };
}

function formatRange(min, max) {
  const lo = min ? `above ${min.toLocaleString("en-IN")}` : "no floor";
  const hi = max ? `up to ${max.toLocaleString("en-IN")}` : "no ceiling";
  return `${lo}, ${hi}`;
}

/**
 * `caseFacts` is { caseType, subjectMatter, claimAmount, jurisdictionState }
 * (all optional except caseType). `forums` is every row from legalForums.
 * Returns forums sorted by score descending, each annotated with
 * { score, reasons: string[], eligible: boolean } -- `eligible` is false
 * when the forum's own caseTypeTags don't cover this case's type at all
 * (still returned, just ranked last and visually de-emphasized by the UI,
 * since a user occasionally does want to see the full catalog).
 */
export function recommendForums(caseFacts, forums) {
  const { caseType, subjectMatter, claimAmount } = caseFacts || {};

  return forums
    .map((forum) => {
      let score = 0;
      const reasons = [];
      const caseTypeTags = forum.caseTypeTags || [];
      const eligible = !caseType || caseTypeTags.length === 0 || caseTypeTags.includes(caseType);

      if (caseType && caseTypeTags.includes(caseType)) {
        score += CASE_TYPE_MATCH_SCORE;
        reasons.push(`Handles "${caseType}" matters`);
      } else if (caseType && caseTypeTags.length > 0) {
        reasons.push(`Does not typically handle "${caseType}" matters`);
      }

      const matchedTags = subjectMatches(subjectMatter, forum.subjectTags);
      if (matchedTags.length) {
        score += SUBJECT_TAG_MATCH_SCORE;
        reasons.push(`Subject matches: ${matchedTags.join(", ")}`);
      }

      if (forum.pecuniaryMin != null || forum.pecuniaryMax != null) {
        const { fits, min, max } = pecuniaryFit(claimAmount, forum.pecuniaryMin, forum.pecuniaryMax);
        if (fits === true) {
          score += PECUNIARY_FIT_SCORE;
          reasons.push(`Claim amount fits its pecuniary range (${formatRange(min, max)})`);
        } else if (fits === false) {
          reasons.push(`Claim amount falls outside its pecuniary range (${formatRange(min, max)})`);
        } else {
          score -= PECUNIARY_UNKNOWN_PENALTY;
          reasons.push("Claim amount not given -- pecuniary fit can't be checked yet");
        }
      }

      if (!eligible) score -= 100; // sinks well below every eligible forum without hiding it

      return { forum, score, reasons, eligible };
    })
    .sort((a, b) => b.score - a.score);
}
