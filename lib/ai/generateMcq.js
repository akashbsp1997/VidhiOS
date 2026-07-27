// lib/ai/generateMcq.js
//
// Generates ONE fresh Prelims-style MCQ for a subtopic -- 4 options, one
// correct, a short explanation. Deliberately separate from
// lib/ai/generateQuestion.js's descriptive-question generator: different
// output shape (options/correctIndex, no marks tiering) and a different
// grading path -- deterministic option-match, no AI grading call needed
// (see app/api/mcq/route.js), unlike a descriptive answer which always
// needs lib/ai/grade.js.

import { callClaudeForJSON } from "./client.js";
import { ANTI_HALLUCINATION_NOTE } from "../subjects/config.js";

function buildSystem(subjectConfig) {
  const extra = subjectConfig.mcqSystemExtra ? `\n${subjectConfig.mcqSystemExtra}` : "";
  return `You write UPSC Civil Services Prelims-style multiple-choice questions on ${subjectConfig.examLabel} topics, in the exact register of real UPSC Prelims questions (single correct answer, plausible distractors, no "all of the above"/"none of the above" unless genuinely warranted).
Ground every claim ONLY in material you are highly confident is accurate, or in the source excerpts provided to you. ${ANTI_HALLUCINATION_NOTE}${extra}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "questionText": "<the question, in UPSC Prelims phrasing>",
  "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
  "correctIndex": <0-3, the index of the correct option>,
  "explanation": "<1-3 sentences explaining why the correct option is right>"
}`;
}

// 1-3, same tier convention as lib/adaptive/engine.js's difficulty ladder --
// only actually varies the generated question when a caller passes
// difficultyTier explicitly (see app/api/mcq/route.js's puzzle-chain
// support); the plain flat MCQ pool omits it and gets DIFFICULTY_HINT[2]
// (typical UPSC Prelims difficulty, unchanged from before this existed).
const DIFFICULTY_HINT = {
  1: "Keep this at an easy, single-step level -- one direct calculation or one direct fact, no combined/multi-step reasoning.",
  2: "Aim for typical real UPSC Prelims difficulty -- a moderate 2-3 step problem or a moderately specific factual point.",
  3: "Make this a genuinely tough, multi-step/combined-concept question (e.g. two calculation steps chained together, or a question requiring cross-referencing two distinct facts) -- still fair and solvable, not a trick question.",
};

function buildUserPrompt({ subtopicText, sourceExcerpts, currentAffairsExcerpts, referencePyqs, difficultyTier }) {
  const grounding = sourceExcerpts && sourceExcerpts.length
    ? `\n\nGround your question in this real source material where relevant:\n${sourceExcerpts.join("\n\n").slice(0, 12000)}`
    : "";
  // Same two grounding inputs as lib/ai/generateQuestion.js (see the
  // 2026-07-24 "content-first" change) -- current affairs and reference
  // PYQs, both optional/best-effort, real PYQs used for calibration only.
  const currentAffairs = currentAffairsExcerpts && currentAffairsExcerpts.length
    ? `\n\nRecent real current-affairs items tagged to this subtopic, use where genuinely relevant (do not force a connection if these don't actually fit):\n${currentAffairsExcerpts.map((a) => `- ${a.title}: ${a.summary}`).join("\n").slice(0, 3000)}`
    : "";
  const reference = referencePyqs && referencePyqs.length
    ? `\n\nReal past exam questions on this subtopic, for calibrating difficulty/style/topic ONLY -- do not reproduce or closely paraphrase any of them, write a genuinely different question:\n${referencePyqs.map((q) => `- (${q.marks} marks) ${q.questionText}`).join("\n")}`
    : "";
  const difficultyNote = DIFFICULTY_HINT[difficultyTier] ?? DIFFICULTY_HINT[2];
  return `Subtopic: ${subtopicText}${grounding}${currentAffairs}${reference}

Difficulty for this one question: ${difficultyNote}

Write ONE new MCQ now (an original question, not a restatement of any reference question above). Return only the JSON object.`;
}

export async function generateMcq({ subtopicText, sourceExcerpts, currentAffairsExcerpts, referencePyqs, difficultyTier, subjectConfig }) {
  const result = await callClaudeForJSON({
    system: buildSystem(subjectConfig),
    user: buildUserPrompt({ subtopicText, sourceExcerpts, currentAffairsExcerpts, referencePyqs, difficultyTier }),
    maxTokens: 1500,
  });
  return normalizeMcqResult(result);
}

export function normalizeMcqResult(raw) {
  const questionText = typeof raw?.questionText === "string" ? raw.questionText.trim() : "";
  const options = Array.isArray(raw?.options)
    ? raw.options.filter((o) => typeof o === "string" && o.trim()).map((o) => o.trim())
    : [];
  const correctIndex = Number(raw?.correctIndex);
  const explanation = typeof raw?.explanation === "string" ? raw.explanation.trim() : "";
  if (!questionText || options.length !== 4 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    throw new Error("Model did not return a usable MCQ shape");
  }
  return { questionText, options, correctIndex, explanation };
}
