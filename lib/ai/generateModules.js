// lib/ai/generateModules.js
//
// Module-level content: a subtopic decomposed into independently
// teachable/practiceable/testable sub-concepts (see generateModulePlan),
// each of which gets its own full Teach -> Grasp -> Remember -> Test cycle
// via app/api/module-lesson/route.js -- unlike lib/ai/generateLesson.js,
// which generates one cycle covering the WHOLE subtopic (kept alive as the
// legacy flow for subtopics that already have a complete lessons row).
//
// Deliberately lighter than generateLesson.js's shapes throughout: flat
// keyPoints instead of structured keyProvisions/caseLaw, one combined
// practice call instead of two, and a flat title+keyPoints image prompt
// instead of a nested visualOutline tree (a module is already a narrow
// single concept, so it doesn't need one). Still has its own image phase
// (see generateModuleImage) -- reintroduced after initially being cut for
// cost, at the user's request.

import { callClaudeForJSON, callImageGen } from "./client.js";
import { ANTI_HALLUCINATION_NOTE } from "../subjects/config.js";

// "2-5" dropped in favor of a starting-point/ending-point framing
// (2026-07-24 "rewrite Teach" change) -- modules are meant to read like
// textbook chapters spanning a genuine beginner's starting point through
// everything needed for real UPSC answer-writing on this subtopic, not a
// fixed small count. app/api/module-lesson/route.js's MAX_MODULES (12) is
// the hard sanity ceiling enforced after the AI responds, not stated here as
// a target.
function buildPlanSystem(subjectConfig) {
  return `You break one UPSC syllabus subtopic into independently teachable, practiceable, and testable sub-concepts ("modules") for a ${subjectConfig.examLabel} aspirant -- think of each module as a textbook chapter. First identify this subtopic's real STARTING POINT (what a complete beginner needs first) and its ENDING POINT (everything a student needs to be able to answer any real exam question on this subtopic, across different question framings), then divide that span into as many modules as it genuinely takes to cover it, ordered from basics to problem-solving/application. Each module must be a coherent unit someone could be taught, given practice on, and asked an exam-style question about ON ITS OWN -- not a content-type grouping like "definitions" or "case law" (those aren't independently testable).
If this subtopic is itself a document, institution, or body (a constitution, a commission, a treaty, an act) rather than a bare concept, a natural module sequence often runs: historical background -> how it came to be made/adopted and who made it -> what it borrowed or drew from elsewhere -> its defining features -> its structure (parts/chapters/articles or equivalent) -- but only where the real content genuinely supports that many distinct modules; do not force this shape onto a subtopic it doesn't fit.
${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "modules": [
    { "title": "<short module title, max 10 words>", "scopeNote": "<1-2 sentences narrowing exactly what this module covers and does NOT cover, so later prompts about just this module stay in scope>" }
  ]
}
Provide as many modules as this subtopic genuinely needs (typically several, up to about 12 for a genuinely broad subtopic) -- do not artificially pad or artificially compress. Order foundational to advanced/applied. Do not overlap module scopes.`;
}

function buildPlanUserPrompt({ subtopicText, sourceExcerpts, currentAffairsExcerpts, referencePyqs, caseAnchors }) {
  const grounding = sourceExcerpts && sourceExcerpts.length
    ? `\n\nReal source material for this subtopic, for grounding (do not quote at length):\n${sourceExcerpts.join("\n\n").slice(0, 12000)}`
    : "";
  const currentAffairs = currentAffairsExcerpts && currentAffairsExcerpts.length
    ? `\n\nReal current-affairs items tagged to this subtopic, use to understand what's currently relevant (do not force a connection that doesn't fit):\n${currentAffairsExcerpts.map((a) => `- ${a.title}: ${a.summary}`).join("\n").slice(0, 3000)}`
    : "";
  // referencePyqs here is informational (this subtopic has fewer than 2 real
  // PYQs, below the anchoring threshold -- see
  // app/api/module-lesson/route.js's MIN_PYQS_FOR_ANCHORING) -- it should
  // inform the module span, not be treated as a fixed per-module anchor the
  // way buildPyqAnchoredPlanUserPrompt below uses its PYQ list.
  const reference = referencePyqs && referencePyqs.length
    ? `\n\nKnown real exam question(s) on this subtopic, for context on what "the ending point" needs to cover:\n${referencePyqs.map((q) => `- (${q.marks} marks) ${q.questionText}`).join("\n")}`
    : "";
  const anchors = caseAnchors && caseAnchors.length
    ? `\n\nVerified cases known to be relevant to this subtopic:\n${caseAnchors.map((c) => `- ${c.case}: ${c.point}`).join("\n")}`
    : "";
  return `Subtopic: ${subtopicText}${grounding}${currentAffairs}${reference}${anchors}\n\nDecompose this subtopic into modules now. Return only the JSON object.`;
}

// Used instead of buildPlanSystem/buildPlanUserPrompt whenever a subtopic has
// >=2 real PYQs (see app/api/module-lesson/route.js's threshold/selection
// logic) -- a genuinely different task from free decomposition: the AI is
// summarizing N already-fixed real questions into modules, not inventing
// sub-concepts from general knowledge. Kept as separate functions rather
// than branching inside the free-decomposition ones since the two prompts'
// instructions don't share much beyond the JSON shape.
function buildPyqAnchoredPlanSystem(subjectConfig) {
  return `You are given a list of real past-exam questions (PYQs) for one ${subjectConfig.examLabel} syllabus subtopic, plus real source material and current-affairs context for the same subtopic. For EACH question, write a concise module title and a scope note describing what a student must learn to answer that specific question well -- use the source material/current affairs to make the scope note genuinely grounded, not just a restatement of the question.
${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "modules": [
    { "title": "<short module title summarizing what this question tests, max 10 words>", "scopeNote": "<1-2 sentences: what a student needs to know/be able to do to answer THIS question well>" }
  ]
}
Return exactly one entry per question, in the SAME ORDER as given below -- do not skip, merge, or reorder any.`;
}

function buildPyqAnchoredPlanUserPrompt({ subtopicText, pyqCandidates, sourceExcerpts, currentAffairsExcerpts }) {
  const list = pyqCandidates.map((q, i) => `${i + 1}. (${q.marks} marks) ${q.questionText}`).join("\n");
  const grounding = sourceExcerpts && sourceExcerpts.length
    ? `\n\nReal source material for this subtopic, for grounding (do not quote at length):\n${sourceExcerpts.join("\n\n").slice(0, 12000)}`
    : "";
  const currentAffairs = currentAffairsExcerpts && currentAffairsExcerpts.length
    ? `\n\nReal current-affairs items tagged to this subtopic, use to understand what's currently relevant (do not force a connection that doesn't fit):\n${currentAffairsExcerpts.map((a) => `- ${a.title}: ${a.summary}`).join("\n").slice(0, 3000)}`
    : "";
  return `Subtopic: ${subtopicText}

Real past-exam questions for this subtopic, in order:
${list}${grounding}${currentAffairs}

Write one module title + scope note per question above, in the same order. Return only the JSON object.`;
}

// Raised from 300-500 words (2026-07-24 "rewrite Teach" change) -- this is
// now meant to be genuinely comprehensive for its module's scope (real
// source material, current affairs, and the subtopic's real PYQs are all
// fed in now, see buildModuleTeachUserPrompt below), not a short summary.
//
// currentAffairsLink is a SEPARATE field, not folded into teachContent
// (2026-07-26, per explicit request: teach the base concept fully first
// from NCERT/government/other sources, THEN correlate current affairs at
// the end, explicitly for use in answer writing) -- a distinct closing
// section rather than current-affairs points scattered wherever they
// happened to fit among the base-concept bullets, so a student revising
// can find "what's new to cite" in one place.
function buildModuleTeachSystem(subjectConfig) {
  return `You are writing a focused, comprehensive explanation of ONE narrow sub-concept (a "module") within a larger ${subjectConfig.examLabel} syllabus subtopic, for a self-study aspirant going from zero knowledge of this module to fully answer-writing-ready on it. Stay strictly within the module's stated scope -- the broader subtopic's other angles are covered by other modules, not this one.

You may be given source material from SEVERAL categories (NCERT, government/official, newspaper, other) -- draw on EVERY category you're actually given, not just whichever one is richest; a student relying on this as their sole source needs the NCERT foundation AND the government/official detail AND anything else provided, not just one.

Teach this as a STORY of how this thing came to be and what it does, not a dry checklist of facts -- walk through these beats in order, but treat them as a narrative arc to adapt, not a rigid form: skip or compress any beat that genuinely doesn't fit this module's real content, and never force one on.
1. Origin and context -- what came before, what real problem, gap, or historical moment led to this existing at all.
2. Its essential nature -- what fundamental kind of thing this is; where a real, informative comparison exists (e.g. how India's version differs from a comparable one elsewhere, or how this concept differs from something it's easily confused with), draw that comparison briefly.
3. A precise working definition of what it actually is, now that the context is set.
4. Who is responsible for it, and how -- who created, authored, or established it (or who is centrally responsible for it today), and, if applicable, how they came to be in that position (composition, selection, appointment, process). Skip this lightly if the module genuinely has no "who made it" angle (a purely quantitative or natural-process topic, say).
5. How it addresses the different aspects of what it covers or governs -- its real structure, provisions, mechanics, or components.
6. Why it's called or structured the way it is, and why it actually matters -- its real significance, not a generic "this is important" line.
Always lead with origin and context before jumping to a bare definition -- that ordering is the point, not an afterthought.
Ground every claim ONLY in material you are highly confident is accurate, or in what's given to you. ${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "teachContent": "<600-1200 words of this module's CORE explanation as a BULLETED list, not connected prose -- one clear, self-contained point per line, each line starting with '- ', separated by \\n (a single newline, not \\n\\n). This is the base concept ONLY -- do not fold current-affairs correlation in here, that goes in currentAffairsLink below.>",
  "keyPoints": [ "<a short, self-contained factual point worth remembering from this module. If this exact fact is what one of the real exam questions you were given actually tested, end the point with ' (UPSC <year>)' using that question's real year -- only when it's a genuine direct match, never guessed or forced. HARD CAP: 30 words.>" ],
  "currentAffairsLink": [ "<ONE point connecting a specific real current-affairs item you were given to this module, phrased as something a student could actually cite in an answer (e.g. 'Cite the 2026 X ruling/report/event as a recent example when answering on Y'). Only from current-affairs items actually given to you -- if none were given, or none genuinely connect, return an empty array rather than forcing one.>" ]
}
Provide 5-10 keyPoints and up to 5 currentAffairsLink points (fewer, or zero, if genuinely that's all that fits -- never pad). Every field has a hard word/count cap stated above -- stop well before it, do not pad to fill it.`;
}

function buildModuleTeachUserPrompt({ subtopicText, moduleTitle, moduleScope, pyqQuestionText, sourceExcerpts, currentAffairsExcerpts, relatedPyqs }) {
  // Lighter anti-leak instruction than practice's below -- teachContent is
  // explanatory prose, not a question, so the main risk is smaller (the
  // student seeing the real Test question rendered inline in Teach), but
  // still worth explicitly guarding against.
  const anchor = pyqQuestionText
    ? `\n\nWrite the explanation so a student who reads it could then answer this real exam question: "${pyqQuestionText}" -- but do not quote or restate the question itself in the explanation.`
    : "";
  const grounding = sourceExcerpts && sourceExcerpts.length
    ? `\n\nReal source material for this subtopic, for grounding (do not quote at length):\n${sourceExcerpts.join("\n\n").slice(0, 12000)}`
    : "";
  const currentAffairs = currentAffairsExcerpts && currentAffairsExcerpts.length
    ? `\n\nReal current-affairs items tagged to this subtopic -- use these for currentAffairsLink (do not force a connection that doesn't genuinely fit this module's scope, and do not fold these into teachContent):\n${currentAffairsExcerpts.map((a) => `- ${a.title}: ${a.summary}`).join("\n").slice(0, 3000)}`
    : "";
  // The subtopic's broader real PYQ history (not just this module's own
  // anchor, if it has one) -- so the explanation can genuinely address
  // "different kinds of question setting," not just the one question this
  // module happens to be anchored to.
  // Years included (2026-08-03, per analysis of how real coaching material
  // teaches this content -- e.g. tagging specific facts "[UPSC 2022]" right
  // next to the fact itself, not just listing exam questions separately) so
  // buildModuleTeachSystem's keyPoints instruction can tag an individual
  // fact with the real year it was tested, not just anchor the whole module.
  const related = relatedPyqs && relatedPyqs.length
    ? `\n\nReal exam questions asked on this subtopic (for context on the range of ways it's tested, and for keyPoints' "(UPSC <year>)" tagging -- only cover the ones actually within this module's own scope, ignore the rest):\n${relatedPyqs.map((q) => `- ${q.year}, ${q.marks} marks: ${q.questionText}`).join("\n")}`
    : "";
  return `Subtopic: ${subtopicText}
Module: "${moduleTitle}" -- ${moduleScope}${anchor}${grounding}${currentAffairs}${related}

Write this module's explanation now, staying strictly within its scope. Return only the JSON object.`;
}

// Interactive Story Mode (explicit request: "the user is part of the story
// or plays a character, and that way learns the chapter") -- an OPTIONAL
// enrichment layered on top of an already-taught module, not a gate. Reuses
// teachContent/keyPoints as its only factual basis rather than researching
// anything new, and every choice leads to the SAME next scene/facts --
// choices are for immersion, not branching content. Keeping the story
// linear regardless of choice is a deliberate scope decision: real
// branching would multiply generation cost/complexity per module for a
// feature whose whole point is retention, not replayability, and it means
// every student reliably learns the same real content no matter what they
// click.
function buildModuleStorySystem(subjectConfig) {
  return `You are turning ONE already-taught ${subjectConfig.examLabel} syllabus module into a short interactive story, so the student experiences the content as a character living through it rather than reading it as facts. You are given the module's own already-written explanation and key points -- use ONLY those as your factual basis, do not introduce new claims.
${ANTI_HALLUCINATION_NOTE}

Write 4-6 short scenes, in order, that put the student (write in second person, "you") INSIDE this module's real content as a lived moment -- e.g. in the room, in the situation, facing the actual people/events/mechanics this concept involves -- not facts narrated at them. Each scene ends with a choice point: 2-3 short options the student can pick, each with a brief in-story reaction that reinforces one real fact from the module. IMPORTANT: every choice leads to the exact SAME next scene and the same facts learned -- choices are for immersion and engagement only, do not write different follow-up content per choice.

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "scenes": [
    {
      "sceneText": "<2nd-person narration placing the student inside a real moment from this module's content. HARD CAP: 90 words.>",
      "choices": [
        { "label": "<short choice, max 8 words>", "reaction": "<1-2 sentence in-story consequence that reinforces one real fact. HARD CAP: 40 words.>" }
      ]
    }
  ]
}
Provide 4-6 scenes and 2-3 choices per scene. Every field has a hard word cap stated above -- stop well before it, do not pad to fill it. The LAST scene should bring the story to a natural close tied to this module's real significance.`;
}

function buildModuleStoryUserPrompt({ subtopicText, moduleTitle, teachContent, keyPoints }) {
  const points = keyPoints && keyPoints.length ? `\n\nKey points to weave in:\n${keyPoints.map((k) => `- ${k}`).join("\n")}` : "";
  return `Subtopic: ${subtopicText}
Module: "${moduleTitle}"

This module's already-written explanation (your ONLY factual basis):
${teachContent}${points}

Write the interactive story now. Return only the JSON object.`;
}

// Time-Scene Challenge -- "an apparition into a location of the real world
// where history-related clothed humans and environment is shown, asked to
// identify specifics like during which revolution or which part of the
// world/society this is tied to." Descriptive prose, not an image
// (this app's image generation is deliberately flat-diagram-style, not
// photorealistic scene rendering -- see buildModuleImagePrompt) -- the
// "apparition" is a vividly written scene, not a picture. One AI call,
// cached forever, same convention as Story Mode; grading is a plain known-
// answer multiple choice, entirely client-side, never the overnight batch
// pipeline.
function buildModuleSceneSystem(subjectConfig) {
  return `You are writing an immersive "time-scene" for ONE already-taught ${subjectConfig.examLabel} syllabus module, so the student experiences a real historical/geographic moment from this module's content vividly, then has to correctly identify it. You are given the module's own already-written explanation -- use ONLY that as your factual basis, do not invent anything not grounded in it.
${ANTI_HALLUCINATION_NOTE}

Write ONE second-person scene ("you") that drops the student into a real moment tied to this module -- describe the people (their dress, bearing), the setting, the atmosphere, vividly and specifically -- without ever naming the exact era/event/region/society outright (that's what the question asks them to identify). Then write ONE identification question with exactly 4 options (one correct, three real-but-wrong alternatives from the same general subject area, not absurd ones) about what the scene depicts (e.g. which revolution, which period, which region, which society/civilization).

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "sceneText": "<vivid 2nd-person scene, specific and sensory, never naming the answer outright. HARD CAP: 130 words.>",
  "question": "<the identification question, e.g. 'Which period does this scene depict?'>",
  "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
  "correctIndex": <0-3, the index of the correct option>,
  "explanation": "<1-2 sentences grounding why this is correct, tied to the module's real content. HARD CAP: 40 words.>"
}
Exactly 4 options, in any order (correctIndex marks the right one). Every field has a hard word cap stated above.`;
}

function buildModuleSceneUserPrompt({ subtopicText, moduleTitle, teachContent }) {
  return `Subtopic: ${subtopicText}
Module: "${moduleTitle}"

This module's already-written explanation (your ONLY factual basis):
${teachContent}

Write the time-scene challenge now. Return only the JSON object.`;
}

function buildModulePracticeSystem(subjectConfig) {
  return `You are writing practice material and a memory aid for ONE narrow sub-concept (a "module") within a larger ${subjectConfig.examLabel} syllabus subtopic. You will be given the module's own explanation already written -- build on it, stay consistent with it, do not stray outside the module's scope into the rest of the subtopic.
Ground every claim ONLY in the module explanation given to you or material you are highly confident is accurate. ${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "examples": [
    { "title": "<short label, max 8 words>", "body": "<a worked example or illustration applying just this module's concept, as 1-2 short BULLET POINTS, not a prose sentence -- each starting with '- ', separated by \\n. HARD CAP: 50 words total.>" }
  ],
  "exercises": [
    { "prompt": "<a short question or scenario testing just this module's concept. HARD CAP: 35 words.>", "hint": "<a one-line nudge, not the answer. HARD CAP: 15 words.>", "modelAnswer": "<a concise model answer, as a BULLETED list of its key moves (not a prose paragraph) -- one per line, each starting with '- ', separated by \\n. HARD CAP: 60 words total.>" }
  ],
  "mnemonic": { "device": "<one mnemonic device for this module -- acronym, phrase, or memory device>", "explanation": "<what it maps to. HARD CAP: 35 words.>" }
}
Provide 1-2 examples, 1-2 exercises, and exactly one mnemonic. Every field has a hard word cap stated above -- stop well before it, do not pad to fill it.`;
}

function buildModulePracticeUserPrompt({ subtopicText, moduleTitle, moduleScope, teachContent, pyqQuestionText }) {
  // Softer than before (2026-07-24) -- this module's Test stage no longer
  // asks pyqQuestionText verbatim, it generates its own question using
  // pyqQuestionText only as a reference (see generateModuleTest below), so
  // there's no longer a literal-leak risk. Still worth keeping exercises
  // distinct from "the obvious direct exam question on this topic" so Grasp
  // builds transferable skill rather than pre-answering whatever Test
  // independently generates from the same anchor.
  const anchor = pyqQuestionText
    ? `\n\nThis module is anchored to this real past exam question (for topic/difficulty calibration, not to be reproduced here):\n"""\n${pyqQuestionText}\n"""\nWrite exercises that build the skills needed to answer a question like this, not a close paraphrase of it.`
    : "";
  return `Subtopic: ${subtopicText}
Module: "${moduleTitle}" -- ${moduleScope}

This module's explanation already written:
"""
${teachContent}
"""${anchor}

Write the practice material and mnemonic now, staying strictly within this module's scope. Return only the JSON object.`;
}

// Test-stage generation (2026-07-24 "content-first" change) -- a
// PYQ-anchored module used to serve its anchor PYQ verbatim for Test, zero
// AI. Now every module's Test is generated, grounded in this module's own
// teachContent (what was actually taught), with the anchor PYQ (when one
// exists) passed only as a style/difficulty/topic-fidelity reference --
// mirrors buildModulePracticeUserPrompt's anchor clause above, same
// "reference, not verbatim" principle applied to the question itself now
// instead of just practice exercises.
function buildModuleTestSystem(subjectConfig) {
  return `You write ONE exam-style Test question for a narrow sub-concept (a "module") within a larger ${subjectConfig.examLabel} syllabus subtopic, in the exact style and register of real UPSC questions. The student has already studied this module's explanation (given to you) -- test exactly what it covers, nothing outside its scope.
Ground every claim ONLY in the module's own explanation given to you, or material you are highly confident is accurate. ${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "questionText": "<the question, in UPSC phrasing>",
  "marks": <10 | 15 | 20, matching realistic UPSC weight for this kind of question>
}`;
}

function buildModuleTestUserPrompt({ subtopicText, moduleTitle, moduleScope, teachContent, pyqQuestionText, pyqMarks }) {
  const anchor = pyqQuestionText
    ? `\n\nThis module is anchored to this real past exam question -- use it ONLY to calibrate difficulty/style/topic, do NOT reproduce it or a close paraphrase of it:\n"""\n${pyqQuestionText}\n"""${pyqMarks ? ` (real marks weight: ${pyqMarks})` : ""}`
    : "";
  return `Subtopic: ${subtopicText}
Module: "${moduleTitle}" -- ${moduleScope}

This module's explanation already taught:
"""
${teachContent}
"""${anchor}

Write ONE new Test question now for this module (an original question, not a restatement of the reference above if one was given). Return only the JSON object.`;
}

// Flat prompt from title+keyPoints rather than lib/ai/generateLesson.js's
// nested visualOutline tree -- a module is already one narrow concept, so
// its keyPoints (3-6 short bullets) are enough boxes for a simple diagram
// without needing a hierarchy to flatten first.
function buildModuleImagePrompt(moduleTitle, keyPoints) {
  const labels = (keyPoints || []).slice(0, 6);
  return `Create a simple, clean educational diagram (flat infographic style, plain background, no photorealism) illustrating the concept "${moduleTitle}".
Structure it as a small hierarchy or flowchart using ONLY these short labels, spelled EXACTLY as given, one per box, large and clearly legible: ${labels.map((l) => `"${l}"`).join(", ")}.
Do not add any other text, numbers, citations, or labels beyond these -- keep every label short and the layout uncluttered. This is a memory aid, not a data-dense chart.`;
}

// 12, not 5 -- must track app/api/module-lesson/route.js's MAX_MODULES (the
// actual sanity ceiling this mirrors defensively in case the model returns
// more than asked).
export function normalizeModulePlanResult(raw) {
  const modules = Array.isArray(raw?.modules)
    ? raw.modules
        .filter((m) => m && typeof m.title === "string" && m.title.trim())
        .slice(0, 12)
        .map((m) => ({
          title: m.title.trim().slice(0, 120),
          scopeNote: typeof m.scopeNote === "string" ? m.scopeNote.trim().slice(0, 500) : "",
        }))
    : [];
  if (!modules.length) {
    throw new Error("Model did not return usable modules");
  }
  return modules;
}

// Deliberately NOT reusing normalizeModulePlanResult's .filter() -- that
// would silently misalign a later PYQ's title to an earlier PYQ's pyqId the
// moment the AI returns a short/malformed entry (filtering shifts every
// subsequent index). This iterates pyqCandidates (the real, trusted data),
// not raw.modules, and falls back to a deterministic title per-entry
// instead of throwing -- safe because real PYQ data is always available as
// a title fallback here, unlike the free-decomposition path.
export function normalizeModulePlanFromPyqsResult(raw, pyqCandidates) {
  const entries = Array.isArray(raw?.modules) ? raw.modules : [];
  return pyqCandidates.map((pyq, i) => {
    const entry = entries[i];
    const title = typeof entry?.title === "string" && entry.title.trim() ? entry.title.trim().slice(0, 120) : `PYQ ${pyq.year} Q${pyq.slot}${pyq.sub}`;
    const scopeNote = typeof entry?.scopeNote === "string" ? entry.scopeNote.trim().slice(0, 500) : "";
    return { title, scopeNote, pyqId: pyq.id };
  });
}

export function normalizeModuleTestResult(raw) {
  const allowedMarks = [10, 15, 20];
  let marks = Number(raw?.marks);
  if (!allowedMarks.includes(marks)) marks = 15;
  const questionText = typeof raw?.questionText === "string" ? raw.questionText.trim() : "";
  if (!questionText) {
    throw new Error("Model did not return a usable questionText");
  }
  return { questionText, marks };
}

export function normalizeModuleTeachResult(raw) {
  const teachContent = typeof raw?.teachContent === "string" ? raw.teachContent.trim() : "";
  if (!teachContent) {
    throw new Error("Model did not return usable teachContent");
  }
  const keyPoints = Array.isArray(raw?.keyPoints)
    ? raw.keyPoints.filter((p) => typeof p === "string" && p.trim()).slice(0, 10).map((p) => p.trim().slice(0, 200))
    : [];
  // Deliberately separate from keyPoints -- see buildModuleTeachSystem's
  // comment on why current-affairs correlation is its own closing section
  // rather than folded into teachContent.
  const currentAffairsLink = Array.isArray(raw?.currentAffairsLink)
    ? raw.currentAffairsLink.filter((p) => typeof p === "string" && p.trim()).slice(0, 5).map((p) => p.trim().slice(0, 300))
    : [];
  // 8000, not 4000 -- tracks buildModuleTeachSystem's raised 600-1200 word target.
  return { teachContent: teachContent.slice(0, 8000), keyPoints, currentAffairsLink };
}

export function normalizeModuleStoryResult(raw) {
  const scenes = Array.isArray(raw?.scenes)
    ? raw.scenes
        .filter((s) => s && typeof s.sceneText === "string" && s.sceneText.trim())
        .slice(0, 6)
        .map((s) => ({
          sceneText: s.sceneText.trim().slice(0, 600),
          choices: Array.isArray(s.choices)
            ? s.choices
                .filter((c) => c && typeof c.label === "string" && c.label.trim())
                .slice(0, 3)
                .map((c) => ({ label: c.label.trim().slice(0, 80), reaction: typeof c.reaction === "string" ? c.reaction.trim().slice(0, 300) : "" }))
            : [],
        }))
    : [];
  if (!scenes.length) {
    throw new Error("Model did not return usable story scenes");
  }
  return scenes;
}

export function normalizeModuleSceneResult(raw) {
  const sceneText = typeof raw?.sceneText === "string" ? raw.sceneText.trim().slice(0, 900) : "";
  const question = typeof raw?.question === "string" ? raw.question.trim().slice(0, 200) : "";
  const options = Array.isArray(raw?.options)
    ? raw.options.filter((o) => typeof o === "string" && o.trim()).slice(0, 4).map((o) => o.trim().slice(0, 150))
    : [];
  let correctIndex = Number(raw?.correctIndex);
  const explanation = typeof raw?.explanation === "string" ? raw.explanation.trim().slice(0, 300) : "";
  if (!sceneText || !question || options.length !== 4 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    throw new Error("Model did not return a usable time-scene challenge");
  }
  return { sceneText, question, options, correctIndex, explanation };
}

export function normalizeModulePracticeResult(raw) {
  const examples = Array.isArray(raw?.examples)
    ? raw.examples
        .filter((e) => e && typeof e.title === "string" && typeof e.body === "string")
        .slice(0, 2)
        .map((e) => ({ title: e.title.slice(0, 120), body: e.body.slice(0, 600) }))
    : [];

  const exercises = Array.isArray(raw?.exercises)
    ? raw.exercises
        .filter((e) => e && typeof e.prompt === "string")
        .slice(0, 2)
        .map((e) => ({
          prompt: e.prompt.slice(0, 400),
          hint: typeof e.hint === "string" ? e.hint.slice(0, 200) : "",
          modelAnswer: typeof e.modelAnswer === "string" ? e.modelAnswer.slice(0, 700) : "",
        }))
    : [];

  const mnemonic =
    raw?.mnemonic && typeof raw.mnemonic.device === "string"
      ? { device: raw.mnemonic.device.slice(0, 300), explanation: typeof raw.mnemonic.explanation === "string" ? raw.mnemonic.explanation.slice(0, 400) : "" }
      : null;

  return { examples, exercises, mnemonic };
}

/**
 * Phase 0 (fallback) -- runs once per subtopic when the module flow is
 * first entered, no lesson_modules rows exist yet, AND the subtopic has
 * fewer than 2 real PYQs (see app/api/module-lesson/route.js's threshold).
 * `referencePyqs`, when present, is the subtopic's 0-1 existing real PYQs
 * (below the anchoring threshold) passed as informational context, not
 * per-module anchors.
 */
export async function generateModulePlan({ subtopicText, sourceExcerpts, currentAffairsExcerpts, referencePyqs, caseAnchors, subjectConfig }) {
  const raw = await callClaudeForJSON({
    system: buildPlanSystem(subjectConfig),
    user: buildPlanUserPrompt({ subtopicText, sourceExcerpts, currentAffairsExcerpts, referencePyqs, caseAnchors }),
    maxTokens: 1200,
  });
  return normalizeModulePlanResult(raw);
}

/**
 * Phase 0 (PYQ-anchored) -- the preferred path, used whenever the subtopic
 * has >=2 real PYQs. `pyqCandidates` is already selected/ordered by the
 * caller (year-desc selection, then re-sorted marks-ascending for
 * foundational-to-advanced presentation order) -- this function's job is
 * purely "summarize these real questions into modules," not selection.
 */
export async function generateModulePlanFromPyqs({ subtopicText, pyqCandidates, sourceExcerpts, currentAffairsExcerpts, subjectConfig }) {
  const raw = await callClaudeForJSON({
    system: buildPyqAnchoredPlanSystem(subjectConfig),
    user: buildPyqAnchoredPlanUserPrompt({ subtopicText, pyqCandidates, sourceExcerpts, currentAffairsExcerpts }),
    maxTokens: 1200,
  });
  return normalizeModulePlanFromPyqsResult(raw, pyqCandidates);
}

/**
 * Phase 1 (per module) -- runs on first Teach visit to this module.
 * `pyqQuestionText` is only passed for a PYQ-anchored module (see
 * app/api/module-lesson/route.js) -- grounds the explanation in the real
 * question without quoting it. `sourceExcerpts`/`currentAffairsExcerpts`/
 * `relatedPyqs` (2026-07-24 "rewrite Teach" change) are the subtopic-wide
 * grounding this phase never had before -- fetched by
 * lib/adaptive/moduleContentReady.js's ensureModuleStagePhase, the shared
 * choke point both the live route and the nightly prepare-next-day cron
 * call.
 */
export async function generateModuleTeach({ subtopicText, moduleTitle, moduleScope, pyqQuestionText, sourceExcerpts, currentAffairsExcerpts, relatedPyqs, subjectConfig }) {
  const raw = await callClaudeForJSON({
    system: buildModuleTeachSystem(subjectConfig),
    user: buildModuleTeachUserPrompt({ subtopicText, moduleTitle, moduleScope, pyqQuestionText, sourceExcerpts, currentAffairsExcerpts, relatedPyqs }),
    maxTokens: 4000,
  });
  return normalizeModuleTeachResult(raw);
}

/**
 * Phase 2 (per module) -- runs on first Grasp visit to this module; also
 * satisfies Remember (no separate image phase). `pyqQuestionText`, when
 * present, triggers the hard anti-leak instruction in
 * buildModulePracticeUserPrompt so practice material doesn't give away the
 * module's Test question.
 */
export async function generateModulePractice({ subtopicText, moduleTitle, moduleScope, teachContent, pyqQuestionText, subjectConfig }) {
  const raw = await callClaudeForJSON({
    system: buildModulePracticeSystem(subjectConfig),
    user: buildModulePracticeUserPrompt({ subtopicText, moduleTitle, moduleScope, teachContent, pyqQuestionText }),
    maxTokens: 3000,
  });
  return normalizeModulePracticeResult(raw);
}

/**
 * Test-stage generation (2026-07-24 "content-first" change) -- called from
 * app/api/attempt/route.js's handleModuleQuestion for EVERY module now
 * (previously only AI-invented modules; PYQ-anchored ones served their
 * anchor verbatim). `pyqQuestionText`/`pyqMarks` are only passed when
 * `lessonModules.pyqId` is set -- see buildModuleTestUserPrompt's anchor
 * clause for how that's used as a reference, not verbatim source.
 */
export async function generateModuleTest({ subtopicText, moduleTitle, moduleScope, teachContent, pyqQuestionText, pyqMarks, subjectConfig }) {
  const raw = await callClaudeForJSON({
    system: buildModuleTestSystem(subjectConfig),
    user: buildModuleTestUserPrompt({ subtopicText, moduleTitle, moduleScope, teachContent, pyqQuestionText, pyqMarks }),
    maxTokens: 1500,
  });
  return normalizeModuleTestResult(raw);
}

/**
 * Story Mode -- generated lazily the first time a student opens it for a
 * module (see app/api/module-lesson/story/route.js), not part of the
 * teach/practice/image phase chain and not required for progression.
 * `teachContent`/`keyPoints` must already exist (the route only calls this
 * once Teach has generated) -- this never does its own research.
 */
export async function generateModuleStory({ subtopicText, moduleTitle, teachContent, keyPoints, subjectConfig }) {
  const raw = await callClaudeForJSON({
    system: buildModuleStorySystem(subjectConfig),
    user: buildModuleStoryUserPrompt({ subtopicText, moduleTitle, teachContent, keyPoints }),
    maxTokens: 3000,
  });
  return normalizeModuleStoryResult(raw);
}

/**
 * Time-Scene Challenge -- generated lazily the first time a student opens
 * it for a module (see app/api/module-lesson/scene/route.js), not part of
 * the teach/practice/image phase chain and not required for progression.
 */
export async function generateModuleScene({ subtopicText, moduleTitle, teachContent, subjectConfig }) {
  const raw = await callClaudeForJSON({
    system: buildModuleSceneSystem(subjectConfig),
    user: buildModuleSceneUserPrompt({ subtopicText, moduleTitle, teachContent }),
    maxTokens: 1200,
  });
  return normalizeModuleSceneResult(raw);
}

/** Phase 3 (per module) -- runs on first Remember visit. Non-fatal on failure, same as generateLesson.js's generateLessonImage. */
export async function generateModuleImage({ moduleTitle, keyPoints }) {
  try {
    return await callImageGen({ prompt: buildModuleImagePrompt(moduleTitle, keyPoints) });
  } catch (err) {
    console.error(`Module image generation failed for "${moduleTitle}":`, err.message);
    return null;
  }
}
