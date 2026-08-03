// lib/legal/draftTemplates.js
//
// Per-draftType structural guidance for lib/legal/generateDraft.js's system
// prompt -- modeled on lib/ingest/config.js's per-docType config pattern (a
// lookup keyed by type, not a chain of if/else in the caller). Each entry is
// a short description of that document's conventional sections in Indian
// legal/administrative practice, generic across forums since exact
// formatting rules vary by court/tribunal rules -- the drafting prompt
// always tells the model to leave forum-specific formatting to the user's
// eventual filing checklist rather than guess at it.

export const DRAFT_TYPE_STRUCTURE = {
  legal_notice: "A formal notice: sender/recipient details, a clear statement of facts, the specific grievance, the relief/action demanded, a reasonable time limit to comply (commonly 15-30 days, but the case facts may state their own), and a statement that legal proceedings will follow if unmet.",
  petition: "A petition: cause title (forum name, parties, case number if allotted), a numbered statement of facts, the legal grounds relied on, and a prayer clause listing the specific relief sought.",
  plaint: "A civil plaint: cause title, parties with addresses, jurisdiction statement, cause of action with date, valuation of the suit, numbered facts, and a prayer clause.",
  written_statement: "A written statement (defendant's reply to a plaint): a preliminary objections section (if any), a paragraph-by-paragraph response to the plaint's numbered facts (admitted/denied/no knowledge), any additional facts/defenses, and a prayer clause.",
  affidavit: "An affidavit: deponent's details, numbered statements of fact made on personal knowledge or belief (each paragraph should say which), and a verification clause at the end.",
  application: "An application to a court/forum/authority: cause title, the specific request being made, the grounds for it, and a prayer clause.",
  reply: "A reply to a notice/application/petition: point-by-point response to the points raised, any facts or objections in response, and a closing statement of position.",
  appeal: "An appeal: cause title (appellate forum, parties, the impugned order's details -- date, forum, order number), the grounds of appeal (numbered), and a prayer clause.",
  rejoinder: "A rejoinder (reply to the other side's reply): point-by-point response to the new points raised, reaffirming the original position where relevant, and a closing statement.",
  other: "A general legal/administrative document: a clear statement of purpose, the relevant facts, and a closing statement or request as appropriate.",
};

export function getDraftStructure(draftType) {
  return DRAFT_TYPE_STRUCTURE[draftType] || DRAFT_TYPE_STRUCTURE.other;
}
