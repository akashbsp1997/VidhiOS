// lib/ai/generateSubjectBookPlan.js
//
// Subject-wide chapter planning -- the AI call behind db/schema.js's
// subjectBookPlans, which REPLACES per-chapter-isolated
// generateModulePlan/generateModulePlanFromPyqs (lib/ai/generateModules.js)
// as the source of what a chapter's (subtopics row) lesson_modules actually
// are. The whole point versus the per-chapter calls it replaces: every
// chapter in one Subject (subtopics.section, e.g. "Polity") is planned in a
// SINGLE call that can see every sibling chapter at once, so a compound
// chapter (one that genuinely combines two other chapters' material) can be
// recognized and flagged as depending on them -- something a chapter-blind
// call can never do. See app/api/module-lesson/route.js's plan-creation
// branch for how this gets invoked (lazily, once per Subject, cached
// forever) and how per-chapter module rows get inserted from its output.
//
// Deliberately reuses lib/ai/generateModules.js's own normalizeModulePlanResult/
// normalizeModulePlanFromPyqsResult for the actual per-chapter module-list
// validation, rather than re-implementing it here -- same defensive
// positional-safety discipline (never let a malformed/misaligned AI entry
// silently break the pyqId<->module correspondence for a PYQ-anchored
// chapter), just orchestrated across many chapters' worth of one JSON
// response instead of one call each.

import { callClaudeForJSON } from "./client.js";
import { ANTI_HALLUCINATION_NOTE } from "../subjects/config.js";
import { normalizeModulePlanResult, normalizeModulePlanFromPyqsResult } from "./generateModules.js";

const MAX_SOURCE_CHARS_PER_CHAPTER = 1200;
const MAX_CURRENT_AFFAIRS_CHARS_PER_CHAPTER = 800;

// Hand-written, static structuring heuristic -- NEVER derived by
// scraping/ingesting any real institutional book's actual text (this app's
// established copyright discipline: pedagogical INSIGHT only, never
// reproduction). Lives in code as a fixed string for the same reason
// ANTI_HALLUCINATION_NOTE does -- one anchor everything shares, not
// something re-derived per call.
const INSTITUTIONAL_STRUCTURING_INSIGHT =
  "Real UPSC coaching material for a subject like this typically: introduces foundational theory/background before " +
  "applied or case-specific content; groups related thinkers, doctrines, institutions, or events chronologically or " +
  "thematically within a shared theme rather than arbitrarily; and only introduces a compound or cross-cutting " +
  "chapter (one that genuinely spans two otherwise-separate foundational chapters) after each of those foundational " +
  "chapters has been covered on its own. This is a general structuring heuristic about how such material tends to " +
  "be organized -- not specific content, wording, or examples from any real publisher or institute; never invent or " +
  "imply a direct quote from one.";

function buildSubjectBookPlanSystem(subjectConfig, sectionLabel) {
  return `You are planning an entire Subject's worth of teaching material for a ${subjectConfig.examLabel} aspirant -- Subject: "${sectionLabel}". You will be given every real syllabus chapter in this Subject at once, in order. For EACH chapter, decompose it into independently teachable, practiceable, and testable modules (think of each module as a textbook sub-chapter) -- follow the SPECIFIC instruction given under that chapter (some chapters must return exactly one module per a fixed list of real exam questions; others should be freely decomposed, basics to advanced).

${INSTITUTIONAL_STRUCTURING_INSIGHT}

Because you can see every chapter in this Subject at once, also identify genuine PREREQUISITE relationships BETWEEN chapters: a chapter that combines or applies concepts from one or more OTHER chapters in this same list should list those chapters' ids as prerequisites (e.g. a chapter combining one institution's structure with a separate area of law/policy should list both of those other chapters, if both are present in this list) -- only when a real dependency genuinely exists, leave it empty otherwise. Never point a chapter at itself, and never invent an id not given below.

Write every scope note the way an examiner who actually SET this paper would think about what's testable and how topics interrelate -- not the way a textbook author summarizing isolated facts would.
${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "chapters": [
    {
      "subtopicId": "<the exact chapter id as given below>",
      "modules": [
        { "title": "<short module title, max 10 words>", "scopeNote": "<1-2 sentences narrowing exactly what this module covers and does NOT cover>", "articleRef": "<a short legal/structural reference this module is centrally about, e.g. 'Part III: Articles 12-35' -- ONLY when this subject genuinely has numbered articles/parts/sections. Empty string otherwise -- never invent a number.>" }
      ],
      "prerequisiteSubtopicIds": ["<id of another chapter IN THIS LIST that must genuinely be learned first, if any -- usually empty>"]
    }
  ]
}
Return exactly one entry per chapter given below, in the same order, using its exact id.`;
}

function renderChapterBlock(chapter, index) {
  const grounding = chapter.sourceExcerpts && chapter.sourceExcerpts.length
    ? `\nSource material (for grounding, do not quote at length):\n${chapter.sourceExcerpts.join("\n---\n").slice(0, MAX_SOURCE_CHARS_PER_CHAPTER)}`
    : "";
  const currentAffairs = chapter.currentAffairsExcerpts && chapter.currentAffairsExcerpts.length
    ? `\nCurrent affairs tagged to this chapter:\n${chapter.currentAffairsExcerpts.map((a) => `- ${a.title}: ${a.summary}`).join("\n").slice(0, MAX_CURRENT_AFFAIRS_CHARS_PER_CHAPTER)}`
    : "";
  const anchors = chapter.caseAnchors && chapter.caseAnchors.length
    ? `\nVerified cases relevant to this chapter:\n${chapter.caseAnchors.map((c) => `- ${c.case}: ${c.point}`).join("\n")}`
    : "";

  let instruction;
  if (chapter.mode === "pyq-anchored") {
    const list = chapter.pyqCandidates.map((q, i) => `  ${i + 1}. (${q.marks} marks) ${q.questionText}`).join("\n");
    instruction = `This chapter has ${chapter.pyqCandidates.length} real exam questions -- return EXACTLY one module per question below, in the SAME ORDER, do not skip/merge/reorder any:\n${list}`;
  } else {
    const reference = chapter.referencePyqs && chapter.referencePyqs.length
      ? `\nKnown real exam question(s) on this chapter, for context on what the ending point needs to cover:\n${chapter.referencePyqs.map((q) => `  - (${q.marks} marks) ${q.questionText}`).join("\n")}`
      : "";
    instruction = `This chapter has too few real exam questions to anchor to -- decompose it freely into as many modules as it genuinely needs (basics to advanced/applied, up to 12).${reference}`;
  }

  return `Chapter ${index + 1} (id: "${chapter.subtopicId}"): ${chapter.topicText}\n${instruction}${grounding}${currentAffairs}${anchors}`;
}

function buildSubjectBookPlanUserPrompt({ chapters }) {
  const blocks = chapters.map(renderChapterBlock).join("\n\n");
  return `Every chapter in this Subject, in real syllabus order:\n\n${blocks}\n\nPlan modules (and, where genuine, prerequisites) for EVERY chapter above now. Return only the JSON object.`;
}

/**
 * `chapters` -- built by the caller (app/api/module-lesson/route.js), one
 * entry per subtopics row sharing this (subjectId, paper, section):
 * { subtopicId, topicText, mode: "pyq-anchored"|"free", pyqCandidates,
 *   referencePyqs, sourceExcerpts, currentAffairsExcerpts, caseAnchors }.
 * `mode`/`pyqCandidates` routing is decided by the caller using the exact
 * same MIN_PYQS_FOR_ANCHORING/selectPyqCandidates logic the single-chapter
 * path already uses -- this function only renders/validates, it doesn't
 * decide anchoring itself.
 *
 * Returns planData: { [subtopicId]: { modules: [...] | null,
 * prerequisiteSubtopicIds: string[] } } -- `modules` is null only for a
 * free-decomposition chapter whose AI output was entirely unusable; the
 * caller is expected to fall back to an isolated generateModulePlan call
 * for just that one chapter (see normalizeModulePlanResult, which throws
 * on empty rather than ever returning null itself -- this file catches
 * that here so one bad chapter doesn't blow up the whole Subject's plan).
 */
export async function generateSubjectBookPlan({ subjectConfig, sectionLabel, chapters }) {
  const raw = await callClaudeForJSON({
    system: buildSubjectBookPlanSystem(subjectConfig, sectionLabel),
    user: buildSubjectBookPlanUserPrompt({ chapters }),
    maxTokens: 6000,
  });
  return normalizeSubjectBookPlanResult(raw, chapters);
}

export function normalizeSubjectBookPlanResult(raw, chapters) {
  const entries = Array.isArray(raw?.chapters) ? raw.chapters : [];
  const bySubtopicId = new Map(entries.filter((e) => e && typeof e.subtopicId === "string").map((e) => [e.subtopicId, e]));

  const planData = {};
  for (const chapter of chapters) {
    const entry = bySubtopicId.get(chapter.subtopicId);
    let modules;
    if (chapter.mode === "pyq-anchored") {
      // Never throws -- deterministic per-PYQ fallback titles, same
      // positional-safety discipline as the single-chapter path.
      modules = normalizeModulePlanFromPyqsResult({ modules: entry?.modules }, chapter.pyqCandidates);
    } else {
      try {
        modules = normalizeModulePlanResult({ modules: entry?.modules });
      } catch {
        modules = null;
      }
    }
    const validIds = new Set(chapters.map((c) => c.subtopicId));
    const prerequisiteSubtopicIds = Array.isArray(entry?.prerequisiteSubtopicIds)
      ? [...new Set(entry.prerequisiteSubtopicIds.filter((id) => typeof id === "string" && id !== chapter.subtopicId && validIds.has(id)))]
      : [];
    planData[chapter.subtopicId] = { modules, prerequisiteSubtopicIds };
  }
  return planData;
}
