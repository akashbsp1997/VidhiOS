// lib/ai/generateQuestion.js
//
// Generates ONE fresh exam-style question for a subtopic at a target
// difficulty tier. Grounded, when available, in cached source text (see
// lib/sources/fetchAndCache.js) and recent tagged current-affairs items, with
// real PYQs used only as a difficulty/style/topic CALIBRATION reference
// (never served as the question itself -- see the 2026-07-24 "content-first"
// change and lib/ai/contentGrounding.js). All three are optional/best-effort
// -- most subtopics won't have all three available, and this degrades
// gracefully to whatever grounding it does have.

import { callClaudeForJSON } from "./client.js";
import { ANTI_HALLUCINATION_NOTE } from "../subjects/config.js";

const TIER_BRIEF = {
  1: "foundational — similar difficulty to a real UPSC PYQ testing direct knowledge of the provision/doctrine",
  2: "harder — requires connecting two or more sub-doctrines within the topic, or applying the law to a moderately complex fact pattern",
  3: "toughest — analytical/synthesis level: requires cross-topic reasoning, critical evaluation of the law's adequacy, or a genuinely hard fact pattern with competing legal arguments. Still answerable in the real UPSC format, just at the difficulty ceiling and beyond a typical PYQ.",
};

// answerFormat is threaded through (see generateQuestion below) but only
// 'descriptive' is implemented -- an MCQ-based Prelims subject needs a
// genuinely different output shape (options[]/correctOption, no marks
// tiering), not just a reworded prompt, so it fails loudly instead of
// silently emitting the wrong shape.
function buildSystem(subjectConfig) {
  return `You write practice questions for ${subjectConfig.examLabel} aspirants, in the exact style and register of real UPSC questions (either a direct/critical-discussion question or a short fact-pattern problem question, matching how real papers phrase things).
Ground every claim you use ONLY in material you are highly confident is accurate, or in the source excerpts provided to you. ${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "questionText": "<the question, in UPSC phrasing>",
  "marks": <10 | 15 | 20, matching realistic UPSC weight for this kind of question>
}`;
}

function buildUserPrompt({ subtopicText, difficultyTier, sourceExcerpts, currentAffairsExcerpts, referencePyqs, moduleScope }) {
  const brief = TIER_BRIEF[difficultyTier] || TIER_BRIEF[2];
  const grounding = sourceExcerpts && sourceExcerpts.length
    ? `\n\nGround your question in this real source material where relevant (do not quote it at length, just use it to keep provisions/facts accurate):\n${sourceExcerpts.join("\n\n").slice(0, 12000)}`
    : "";
  // Recent real current-affairs items tagged to this subtopic (see
  // lib/ai/contentGrounding.js's recentCurrentAffairsExcerpts) -- optional,
  // most subtopics won't have any, especially doctrinal/legal ones with
  // little current-affairs angle.
  const currentAffairs = currentAffairsExcerpts && currentAffairsExcerpts.length
    ? `\n\nRecent real current-affairs items tagged to this subtopic, use where genuinely relevant (do not force a connection if these don't actually fit):\n${currentAffairsExcerpts.map((a) => `- ${a.title}: ${a.summary}`).join("\n").slice(0, 3000)}`
    : "";
  // Real PYQs as a CALIBRATION reference only, never served directly (see
  // the 2026-07-24 "content-first" change) -- explicit anti-leak instruction
  // so the model doesn't just lightly reword one of these.
  const reference = referencePyqs && referencePyqs.length
    ? `\n\nReal past exam questions on this subtopic, for calibrating difficulty/style/topic ONLY -- do not reproduce or closely paraphrase any of them, write a genuinely different question:\n${referencePyqs.map((q) => `- (${q.marks} marks) ${q.questionText}`).join("\n")}`
    : "";
  // Only set for a module-level Test -- narrows the question to one
  // sub-concept instead of the whole subtopic (see
  // app/api/attempt/route.js's handleModuleQuestion).
  const scope = moduleScope
    ? `\n\nFocus specifically on: "${moduleScope.title}" -- ${moduleScope.scopeNote}. Do not test the rest of the subtopic.`
    : "";
  return `Subtopic: ${subtopicText}
Target difficulty: ${brief}${grounding}${currentAffairs}${reference}${scope}

Write ONE new question now (an original question, not a restatement of any reference question above). Return only the JSON object.`;
}

/**
 * @param {object} params
 * @param {{title: string, scopeNote: string}} [params.moduleScope] -- when
 *   present, narrows the question to one module instead of the whole
 *   subtopic. Omitted by all existing subtopic-level callers, unchanged
 *   behavior for them.
 * @param {{questionText: string, marks: number}[]} [params.referencePyqs] --
 *   real PYQs for calibration only (see lib/ai/contentGrounding.js's
 *   pickReferencePyqs) -- never served as the question itself.
 * @returns {Promise<{questionText: string, marks: number}>}
 */
export async function generateQuestion({ subtopicText, difficultyTier, sourceExcerpts, currentAffairsExcerpts, referencePyqs, subjectConfig, moduleScope }) {
  if (subjectConfig.answerFormat !== "descriptive") {
    throw new Error(`generateQuestion does not yet support answerFormat "${subjectConfig.answerFormat}"`);
  }
  // 1500, not 500 -- raised after a live finish_reason:"length" failure on
  // lib/ingest/config.js's syllabus/pyq_paper calls showed the current free
  // model (see lib/ai/client.js's MODEL) spends a meaningful chunk of its
  // budget before reaching final content regardless of output size, so a
  // small ceiling is proportionally the most exposed to this.
  const result = await callClaudeForJSON({
    system: buildSystem(subjectConfig),
    user: buildUserPrompt({ subtopicText, difficultyTier, sourceExcerpts, currentAffairsExcerpts, referencePyqs, moduleScope }),
    maxTokens: 1500,
  });
  return normalizeQuestionResult(result);
}

export function normalizeQuestionResult(raw) {
  const allowedMarks = [10, 15, 20];
  let marks = Number(raw?.marks);
  if (!allowedMarks.includes(marks)) marks = 15;
  const questionText = typeof raw?.questionText === "string" ? raw.questionText.trim() : "";
  if (!questionText) {
    throw new Error("Model did not return a usable questionText");
  }
  return { questionText, marks };
}
