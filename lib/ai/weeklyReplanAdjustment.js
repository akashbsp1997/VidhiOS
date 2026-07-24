// lib/ai/weeklyReplanAdjustment.js
//
// Part E4's weekly AI adjustment: one call per user per week, run by
// app/api/cron/weekly-replan/route.js once a week boundary is crossed. Reads
// the week just completed (real graded attempts + a weekly test score, when
// one exists) and returns a small structured NUDGE -- which already-learned
// subtopics need extra revision, which upcoming ones to prioritize -- not a
// full schedule. lib/adaptive/planEngine.js's buildDayPlan consumes this as
// a soft bias on top of its existing deterministic sort, never a
// replacement (see db/schema.js's weeklyPlanAdjustments comment).

import { callClaudeForJSON } from "./client.js";
import { ANTI_HALLUCINATION_NOTE } from "../subjects/config.js";

function buildSystem() {
  return `You are a UPSC Civil Services exam-prep coach reviewing one student's past week of real practice. You will be given: the subtopics they wrote graded answers on this week (with scores), their weekly test score if one exists, and their current mastery on every subtopic they've learned so far. Identify which ALREADY-LEARNED subtopics most need extra revision (weak/inconsistent scores, low mastery) and which upcoming subtopics deserve priority next, based on real weakness patterns in what they wrote -- not generic advice.
${ANTI_HALLUCINATION_NOTE}
Only ever reference subtopic ids from the lists you were given -- never invent one.

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "focusSubtopicIds": ["<subtopic id from the 'upcoming' list>", ...],
  "extraRevisionSubtopicIds": ["<subtopic id from the 'learned so far' list>", ...],
  "note": "<1-2 sentences, written directly to the student, explaining the pattern you saw and why these picks>"
}
Keep both lists short (up to 5 ids each) and only include a subtopic you have a real reason for from the data given.`;
}

function buildUserPrompt({ weekAttempts, weeklyTestScore, learnedSoFar, upcoming }) {
  const attemptsBlock = weekAttempts.length
    ? weekAttempts.map((a) => `- ${a.subtopicId} (${a.topicText}): scored ${a.score}/100`).join("\n")
    : "(no graded answers were written this week)";
  const testBlock = weeklyTestScore != null ? `\n\nWeekly test score: ${weeklyTestScore}%` : "\n\nNo weekly test score available yet.";
  const learnedBlock = learnedSoFar.length
    ? learnedSoFar.map((s) => `- ${s.id} (${s.topicText}): mastery ${Math.round(s.masteryScore * 100)}%`).join("\n")
    : "(nothing learned yet)";
  const upcomingBlock = upcoming.length ? upcoming.map((s) => `- ${s.id} (${s.topicText})`).join("\n") : "(nothing scheduled yet)";

  return `This week's graded answers:\n${attemptsBlock}${testBlock}\n\nSubtopics learned so far (id, mastery), pick extraRevisionSubtopicIds only from here:\n${learnedBlock}\n\nUpcoming not-yet-learned subtopics, pick focusSubtopicIds only from here:\n${upcomingBlock}\n\nReturn only the JSON object.`;
}

/**
 * validIds: { learnedSoFarIds: Set<string>, upcomingIds: Set<string> } --
 * the AI response is filtered against these so a hallucinated or
 * out-of-scope id can never leak into buildDayPlan's bias logic.
 */
export function normalizeWeeklyReplanAdjustment(raw, { learnedSoFarIds, upcomingIds }) {
  const focusSubtopicIds = Array.isArray(raw?.focusSubtopicIds)
    ? [...new Set(raw.focusSubtopicIds.filter((id) => typeof id === "string" && upcomingIds.has(id)))].slice(0, 5)
    : [];
  const extraRevisionSubtopicIds = Array.isArray(raw?.extraRevisionSubtopicIds)
    ? [...new Set(raw.extraRevisionSubtopicIds.filter((id) => typeof id === "string" && learnedSoFarIds.has(id)))].slice(0, 5)
    : [];
  const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, 500) : "";
  return { focusSubtopicIds, extraRevisionSubtopicIds, note };
}

/**
 * weekAttempts: [{ subtopicId, topicText, score }]
 * weeklyTestScore: number (0-100) | null
 * learnedSoFar: [{ id, topicText, masteryScore }] -- every subtopic the
 *   student has started, candidates for extraRevisionSubtopicIds.
 * upcoming: [{ id, topicText }] -- not-yet-learned subtopics, candidates for
 *   focusSubtopicIds.
 */
export async function generateWeeklyReplanAdjustment({ weekAttempts, weeklyTestScore, learnedSoFar, upcoming }) {
  const raw = await callClaudeForJSON({
    system: buildSystem(),
    user: buildUserPrompt({ weekAttempts, weeklyTestScore, learnedSoFar, upcoming }),
    maxTokens: 500,
  });
  return normalizeWeeklyReplanAdjustment(raw, {
    learnedSoFarIds: new Set(learnedSoFar.map((s) => s.id)),
    upcomingIds: new Set(upcoming.map((s) => s.id)),
  });
}
