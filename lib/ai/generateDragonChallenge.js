// lib/ai/generateDragonChallenge.js
//
// The Dragon's Challenge -- an RPG hook shown once per (student, subtopic),
// before any teaching happens: a wise old dragon poses a real Mains-level
// question on the subtopic's fundamentals and sends the student to attempt
// it cold. This is a diagnostic (what do you already know?), not a gate --
// see app/api/dragon-challenge/route.js. Only called when the subtopic has
// no real PYQ at MIN_MARKS_FOR_REAL or above to use instead (see that
// route) -- a real question is always preferred, same PYQ-anchoring
// precedent as lib/ai/generateModules.js.

import { callClaudeForJSON } from "./client.js";
import { ANTI_HALLUCINATION_NOTE } from "../subjects/config.js";

function buildDragonQuestionSystem(subjectConfig) {
  return `You are writing ONE tough, genuinely Mains-exam-style question for a ${subjectConfig.examLabel} syllabus subtopic, to be posed cold to a student who hasn't studied this subtopic yet -- it should touch the FOUNDATIONAL/basic parts of the subtopic (what any serious aspirant should be able to attempt from general awareness and reasoning, not obscure detail), in the real style and length of an actual Mains question.
${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "questionText": "<one real Mains-style question, self-contained, in the exact register of an actual UPSC Mains question>",
  "marks": <10, 15, or 20 -- pick whichever a question of this scope would realistically carry>
}`;
}

function buildDragonQuestionUserPrompt({ subtopicText }) {
  return `Subtopic: ${subtopicText}\n\nWrite the question now. Return only the JSON object.`;
}

export function normalizeDragonQuestionResult(raw) {
  const allowedMarks = [10, 15, 20];
  let marks = Number(raw?.marks);
  if (!allowedMarks.includes(marks)) marks = 15;
  const questionText = typeof raw?.questionText === "string" ? raw.questionText.trim() : "";
  if (!questionText) {
    throw new Error("Model did not return a usable questionText");
  }
  return { questionText, marks };
}

export async function generateDragonQuestion({ subtopicText, subjectConfig }) {
  const raw = await callClaudeForJSON({
    system: buildDragonQuestionSystem(subjectConfig),
    user: buildDragonQuestionUserPrompt({ subtopicText }),
    maxTokens: 600,
  });
  return normalizeDragonQuestionResult(raw);
}
