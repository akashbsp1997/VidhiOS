import { callClaudeForJSON, callImageGen } from "./client.js";
import { ANTI_HALLUCINATION_NOTE, getFieldTemplate } from "../subjects/config.js";

function buildCoreSystem(subjectConfig) {
  const fields = subjectConfig.lessonSchema.structuredFields.map(getFieldTemplate);
  const fieldBlocks = fields.map((f) => f.schemaBlock).join(",\n  ");
  const countGuidance = fields.map((f) => f.countGuidance).join(" and ");
  const extraHints = fields.map((f) => f.extraGroundingHint).filter(Boolean).join(" ");

  return `You are writing the core self-study content for a ${subjectConfig.examLabel} aspirant, for ONE syllabus subtopic. This needs to work as a STANDALONE resource — assume the reader has no textbook open besides this.
Ground every claim ONLY in material you are highly confident is accurate, or in the source excerpts / verified anchor list provided to you. ${ANTI_HALLUCINATION_NOTE}${extraHints ? " " + extraHints : ""}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "teachContent": "<800-1200 words as a BULLETED list, not connected prose -- one clear, self-contained point per line, each line starting with '- ', separated by \\n (a single newline, not \\n\\n). Cover what the concept is, its basis, how it developed, the current position, and why it matters, broken into scannable points a student can revise quickly rather than a chapter they have to read start to finish. Group related points together in the order given (basis, then development, then current position, then significance) even though each is its own bullet line.>",
  ${fieldBlocks}
}
Aim for ${countGuidance}, but accuracy over count on all of them.`;
}

// Split into two independent calls (run concurrently in generateLesson)
// instead of one combined "practice" call. The combined version reliably
// blew past a 2600-token budget and truncated mid-JSON (observed live: still
// composing the FIRST perspective's explanation at ~2950 tokens, despite the
// prompt asking for 2-3 sentences there) -- raising the budget enough to fit
// it wasn't viable either, since CORE_SYSTEM + one big PRACTICE call already
// used ~51s of the lesson route's 60s maxDuration. Splitting keeps each
// call's content (and token ceiling) small enough to reliably finish, and
// running them concurrently keeps wall-clock time close to the slower of
// the two rather than their sum. Every length constraint below is stated as
// a hard word/sentence cap, not a suggestion, because softer phrasing
// ("2-3 sentences") was not being respected.
//
// Unlike CORE_SYSTEM, these two aren't parameterized by lessonSchema --
// perspectives/answerFramework/examples/exercises/mnemonics/visualOutline
// are generic pedagogical constructs that fit any descriptive-format
// subject as-is; only the exam label in the prose varies.
function buildPracticeASystem(subjectConfig) {
  return `You are writing critical-thinking material for a ${subjectConfig.examLabel} aspirant's self-study on ONE syllabus subtopic. You will be given the core content already written for this subtopic — build on it, stay consistent with it, do not contradict it.
Ground every claim ONLY in the core content given to you or material you are highly confident is accurate. ${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "perspectives": [
    { "angle": "<a critical viewpoint, debate, criticism, or reform proposal — OR a broader thematic/contemporary connection worth weaving into a strong answer. Max 15 words.>", "explanation": "<developing the angle, as 1-2 short BULLET POINTS, not a prose sentence -- each starting with '- ', separated by \\n. HARD CAP: 40 words total across both bullets. Do not exceed this.>" }
  ],
  "answerFramework": "<how to structure a Mains answer on THIS subtopic specifically, as a BULLETED list of steps (not a prose paragraph) -- one step per line, each starting with '- ', separated by \\n: which of the core content above to lead with, how to sequence the argument, what a 'critically discuss' vs a fact-pattern version of this question would each need. HARD CAP: 120 words total across all bullets.>"
}
Provide exactly 3 perspectives. Every field has a hard word cap stated above — stop well before it, do not pad to fill it.`;
}

function buildPracticeBSystem(subjectConfig) {
  return `You are writing worked examples, self-check exercises, and memory aids for a ${subjectConfig.examLabel} aspirant's self-study on ONE syllabus subtopic. You will be given the core content already written for this subtopic — build on it, stay consistent with it, do not contradict it.
Ground every claim ONLY in the core content given to you or material you are highly confident is accurate. ${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "examples": [
    { "title": "<short label, max 8 words>", "body": "<a worked example or illustration applying the concept, as 1-2 short BULLET POINTS, not a prose sentence -- each starting with '- ', separated by \\n. HARD CAP: 60 words total.>" }
  ],
  "exercises": [
    { "prompt": "<a short question or scenario to test understanding. HARD CAP: 40 words.>", "hint": "<a one-line nudge, not the answer. HARD CAP: 20 words.>", "modelAnswer": "<a concise model answer showing real structure, as a BULLETED list of the answer's key moves (not a prose paragraph) -- one per line, each starting with '- ', separated by \\n. HARD CAP: 80 words total.>" }
  ],
  "mnemonics": [
    { "device": "<the mnemonic itself — acronym, phrase, or memory device>", "explanation": "<what each part stands for / how it maps to the content. HARD CAP: 40 words.>" }
  ],
  "visualOutline": {
    "label": "<the subtopic name, max 6 words>",
    "children": [
      { "label": "<a major sub-concept, max 6 words>", "children": [ { "label": "<a detail, max 6 words>", "children": [] } ] }
    ]
  }
}
Provide exactly 2 examples, 2 exercises, 1 mnemonic, and a visualOutline 2 levels deep with at most 4 top-level children (each with at most 3 sub-children). Every field has a hard word cap stated above — stop well before it, do not pad to fill it.`;
}

function buildCoreUserPrompt({ subtopicText, sourceExcerpts, caseAnchors }) {
  const grounding = sourceExcerpts && sourceExcerpts.length
    ? `\n\nGround provisions in this real source material where relevant (do not quote it at length, just keep facts accurate):\n${sourceExcerpts.join("\n\n").slice(0, 12000)}`
    : "";
  const anchors = caseAnchors && caseAnchors.length
    ? `\n\nVerified cases known to be relevant to this subtopic (use these, expand accurate facts/holding around them):\n${caseAnchors.map((c) => `- ${c.case}: ${c.point}`).join("\n")}`
    : "";
  return `Subtopic: ${subtopicText}${grounding}${anchors}\n\nWrite the core content now. Return only the JSON object.`;
}

// core.keyProvisions/caseLaw are read by name here rather than generically
// over subjectConfig.lessonSchema.structuredFields -- fine while these are
// the only two FIELD_TEMPLATES entries that exist (both gracefully no-op to
// "(none provided)" for a subject that lacks them), but a subject adding a
// genuinely different structured field (e.g. GS's hypothetical keyFacts)
// will want its own context line added here too.
function buildPracticeUserPrompt({ subtopicText, core }) {
  const provisionsList = (core.keyProvisions || []).map((p) => `${p.citation}: ${p.summary}`).join("\n");
  const casesList = (core.caseLaw || []).map((c) => `${c.case}: ${c.significance}`).join("\n");
  return `Subtopic: ${subtopicText}

Core explanation already written:
"""
${core.teachContent}
"""

Key provisions already established:
${provisionsList || "(none provided)"}

Case law already established:
${casesList || "(none provided)"}

Write the content now, consistent with the above. Return only the JSON object. Respect every word cap exactly.`;
}

function normalizeOutlineNode(node, depth = 0) {
  if (!node || typeof node !== "object" || typeof node.label !== "string") return null;
  const children = depth < 2 && Array.isArray(node.children)
    ? node.children.map((c) => normalizeOutlineNode(c, depth + 1)).filter(Boolean).slice(0, 8)
    : [];
  return { label: node.label.slice(0, 120), children };
}

export function normalizeCoreResult(raw, structuredFieldNames) {
  const teachContent = typeof raw?.teachContent === "string" ? raw.teachContent.trim() : "";
  if (!teachContent) {
    throw new Error("Model did not return usable teachContent");
  }

  const structuredFields = {};
  for (const fieldName of structuredFieldNames) {
    structuredFields[fieldName] = getFieldTemplate(fieldName).normalize(raw?.[fieldName]);
  }

  return { teachContent: teachContent.slice(0, 8000), ...structuredFields };
}

export function normalizePracticeResult(raw) {
  const perspectives = Array.isArray(raw?.perspectives)
    ? raw.perspectives
        .filter((p) => p && typeof p.angle === "string")
        .slice(0, 5)
        .map((p) => ({ angle: p.angle.slice(0, 250), explanation: typeof p.explanation === "string" ? p.explanation.slice(0, 500) : "" }))
    : [];

  const examples = Array.isArray(raw?.examples)
    ? raw.examples
        .filter((e) => e && typeof e.title === "string" && typeof e.body === "string")
        .slice(0, 4)
        .map((e) => ({ title: e.title.slice(0, 120), body: e.body.slice(0, 800) }))
    : [];

  const exercises = Array.isArray(raw?.exercises)
    ? raw.exercises
        .filter((e) => e && typeof e.prompt === "string")
        .slice(0, 4)
        .map((e) => ({
          prompt: e.prompt.slice(0, 500),
          hint: typeof e.hint === "string" ? e.hint.slice(0, 300) : "",
          modelAnswer: typeof e.modelAnswer === "string" ? e.modelAnswer.slice(0, 900) : "",
        }))
    : [];

  const mnemonics = Array.isArray(raw?.mnemonics)
    ? raw.mnemonics
        .filter((m) => m && typeof m.device === "string")
        .slice(0, 3)
        .map((m) => ({ device: m.device.slice(0, 300), explanation: typeof m.explanation === "string" ? m.explanation.slice(0, 500) : "" }))
    : [];

  const visualOutline = normalizeOutlineNode(raw?.visualOutline) || { label: "Overview", children: [] };
  const answerFramework = typeof raw?.answerFramework === "string" ? raw.answerFramework.slice(0, 1200) : "";

  return { perspectives, answerFramework, examples, exercises, mnemonics, visualOutline };
}

export function flattenOutlineLabels(node, out = [], depth = 0) {
  if (!node) return out;
  if (depth > 0) out.push(node.label);
  (node.children || []).forEach((c) => flattenOutlineLabels(c, out, depth + 1));
  return out;
}

export function buildImagePrompt(subtopicText, visualOutline) {
  const labels = flattenOutlineLabels(visualOutline).slice(0, 6);
  return `Create a simple, clean educational diagram (flat infographic style, plain background, no photorealism) illustrating the legal concept "${subtopicText}".
Structure it as a small hierarchy or flowchart using ONLY these short labels, spelled EXACTLY as given, one per box, large and clearly legible: ${labels.map((l) => `"${l}"`).join(", ")}.
Do not add any other text, numbers, citations, or labels beyond these — keep every label short and the layout uncluttered. This is a memory aid, not a data-dense chart.`;
}

// Split into three independently-callable phases (2026-07-20), replacing a
// single generateLesson() that ran all three AI call-groups back to back
// the moment a subtopic was clicked -- the most AI work this app ever did,
// compressed into one burst, on the least reliable part of the stack (a
// free-tier model already proven to hang/rate-limit/truncate under load;
// see this file's git history for the finish_reason:"length" failures that
// kept surfacing call-site by call-site as budgets were raised). Each
// phase now runs only when the student actually reaches the stage that
// needs it -- app/api/lesson/route.js owns that decision (it has the DB
// state this module never did) and persists each phase's result
// immediately, so a failure on a later phase never loses an earlier one.

/** Phase 1 -- runs on first Teach visit. */
export async function generateCoreContent({ subtopicText, sourceExcerpts, caseAnchors, subjectConfig }) {
  const coreRaw = await callClaudeForJSON({
    system: buildCoreSystem(subjectConfig),
    user: buildCoreUserPrompt({ subtopicText, sourceExcerpts, caseAnchors }),
    maxTokens: 8000,
  });
  return normalizeCoreResult(coreRaw, subjectConfig.lessonSchema.structuredFields);
}

/**
 * Phase 2 -- runs on first Grasp visit. `core` is the subtopic's already-
 * generated core content -- always read from the DB row by the caller
 * (core and practice never run in the same request), not passed in-memory
 * from a same-request core call.
 */
export async function generatePracticeContent({ subtopicText, core, subjectConfig }) {
  const practiceUser = buildPracticeUserPrompt({ subtopicText, core });
  const [practiceRawA, practiceRawB] = await Promise.all([
    callClaudeForJSON({ system: buildPracticeASystem(subjectConfig), user: practiceUser, maxTokens: 6000 }),
    callClaudeForJSON({ system: buildPracticeBSystem(subjectConfig), user: practiceUser, maxTokens: 8000 }),
  ]);
  return normalizePracticeResult({ ...practiceRawA, ...practiceRawB });
}

/** Phase 3 -- runs on first Remember visit. Non-fatal on failure, as before. */
export async function generateLessonImage({ subtopicText, visualOutline }) {
  try {
    return await callImageGen({ prompt: buildImagePrompt(subtopicText, visualOutline) });
  } catch (err) {
    console.error(`Image generation failed for "${subtopicText}":`, err.message);
    return null;
  }
}
