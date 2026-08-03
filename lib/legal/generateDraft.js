// lib/legal/generateDraft.js
//
// AI-assisted drafting/updating of one legal document for a case. Always
// grounded in the case's OWN stored facts (parties, forum, dates,
// description) passed in by the caller -- never re-fetches or invents case
// details itself, keeping this a pure "facts in, draft text out" function
// the API route controls. Same call handles both first-draft generation and
// later updates: an update just also passes `existingContent` +
// `instructions` describing the change, and the model revises rather than
// starting over.

import { callClaudeForJSON } from "../ai/client.js";
import { getDraftStructure } from "./draftTemplates.js";

const ANTI_HALLUCINATION_NOTE =
  "Use ONLY the case facts given to you below. Where a needed detail (an address, a date, a specific figure) is not among those facts, write a clear placeholder like \"[ADDRESS TO BE FILLED]\" instead of inventing one. Never invent section/act citations, case law, or court rules you were not given -- if legal grounds are relevant but not supplied, write \"[CITE APPLICABLE PROVISION]\" rather than guess one.";

function formatParties(parties) {
  if (!parties?.length) return "(no parties recorded yet)";
  return parties.map((p) => `- ${p.name} (${p.role}${p.partyType ? `, ${p.partyType}` : ""})`).join("\n");
}

function buildSystem(draftType) {
  return `You are drafting a "${draftType.replace(/_/g, " ")}" document for a real legal/administrative case, in formal Indian legal drafting style.
Structure to follow: ${getDraftStructure(draftType)}
${ANTI_HALLUCINATION_NOTE}
This is a first draft for the user's own review and their advocate's review before any filing -- write it complete and properly structured, in plain text with clear paragraph/section breaks (no markdown, no code fences).

Return ONLY a JSON object, no other text, in exactly this shape:
{ "title": "<a short descriptive title for this document>", "content": "<the full drafted document text>" }`;
}

function buildUserPrompt({ caseSummary, parties, forumLabel, caseNumber, instructions, existingContent }) {
  const caseBlock = `Case summary: ${caseSummary || "(none given)"}
Forum: ${forumLabel || "(not yet chosen)"}
Case number: ${caseNumber || "(not yet allotted)"}
Parties:
${formatParties(parties)}`;

  if (existingContent) {
    return `${caseBlock}

Existing draft content:
"""
${existingContent}
"""

Requested change: ${instructions || "General review and improvement -- fix any inconsistency with the case facts above and tighten the language."}

Produce the FULL updated document (not just the changed part). Return only the JSON object.`;
  }

  return `${caseBlock}

Additional drafting instructions: ${instructions || "(none -- draft based on the case facts above alone)"}

Draft the document now. Return only the JSON object.`;
}

/**
 * `caseFacts` is { caseSummary, parties: [{name, role, partyType}],
 * forumLabel, caseNumber }. `instructions` is free-text guidance from the
 * user (required-ish for a meaningful first draft, optional for a light
 * touch-up). `existingContent`, when present, switches this into "update"
 * mode -- the model revises that text rather than starting fresh. Returns
 * { title, content }, both AI-suggested and always shown to the user before
 * being saved (see app/api/legal/drafts/[id]/generate/route.js).
 */
export async function generateDraftContent({ draftType, caseFacts, instructions, existingContent }) {
  const raw = await callClaudeForJSON({
    system: buildSystem(draftType),
    user: buildUserPrompt({ ...caseFacts, instructions, existingContent }),
    maxTokens: 4000,
  });

  const title = typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 200) : `Untitled ${draftType.replace(/_/g, " ")}`;
  const content = typeof raw?.content === "string" ? raw.content.trim() : "";
  return { title, content };
}
