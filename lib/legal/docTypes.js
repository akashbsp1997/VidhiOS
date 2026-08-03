// lib/legal/docTypes.js
//
// Canonical enums for the Legal Case Manager, shared between API routes
// (validation) and UI (dropdown options) so there's exactly one place either
// list can drift from the other -- same pattern as lib/ingest/docTypes.js.

export const LEGAL_CASE_TYPES = [
  { value: "civil", label: "Civil" },
  { value: "criminal", label: "Criminal" },
  { value: "writ", label: "Writ / Constitutional" },
  { value: "consumer", label: "Consumer dispute" },
  { value: "administrative", label: "Administrative" },
  { value: "family", label: "Family" },
  { value: "labour", label: "Labour / Employment" },
  { value: "tax", label: "Tax" },
  { value: "arbitration", label: "Arbitration" },
  { value: "other", label: "Other" },
];

export const LEGAL_CASE_STATUSES = ["draft", "active", "stayed", "disposed", "closed"];

export const LEGAL_PARTY_ROLES = [
  { value: "petitioner", label: "Petitioner" },
  { value: "respondent", label: "Respondent" },
  { value: "plaintiff", label: "Plaintiff" },
  { value: "defendant", label: "Defendant" },
  { value: "appellant", label: "Appellant" },
  { value: "applicant", label: "Applicant" },
  { value: "opposite_party", label: "Opposite party" },
  { value: "witness", label: "Witness" },
  { value: "advocate", label: "Advocate" },
  { value: "third_party", label: "Third party" },
];

export const LEGAL_PARTY_TYPES = ["individual", "organization", "government"];

export const LEGAL_DOCUMENT_TYPES = [
  { value: "pleading", label: "Pleading" },
  { value: "evidence", label: "Evidence" },
  { value: "notice", label: "Notice" },
  { value: "judgment", label: "Judgment" },
  { value: "order", label: "Order" },
  { value: "id_proof", label: "ID proof" },
  { value: "contract", label: "Contract / Agreement" },
  { value: "correspondence", label: "Correspondence" },
  { value: "other", label: "Other" },
];

export const LEGAL_DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

export const LEGAL_EVENT_TYPES = [
  { value: "hearing", label: "Hearing" },
  { value: "filing_deadline", label: "Filing deadline" },
  { value: "limitation_deadline", label: "Limitation deadline" },
  { value: "order_pronounced", label: "Order pronounced" },
  { value: "reminder", label: "Reminder" },
  { value: "other", label: "Other" },
];

export const LEGAL_EVENT_STATUSES = ["upcoming", "completed", "missed", "adjourned"];

export const LEGAL_DRAFT_TYPES = [
  { value: "legal_notice", label: "Legal notice" },
  { value: "petition", label: "Petition" },
  { value: "plaint", label: "Plaint" },
  { value: "written_statement", label: "Written statement" },
  { value: "affidavit", label: "Affidavit" },
  { value: "application", label: "Application" },
  { value: "reply", label: "Reply" },
  { value: "appeal", label: "Appeal" },
  { value: "rejoinder", label: "Rejoinder" },
  { value: "other", label: "Other" },
];

export const LEGAL_DRAFT_STATUSES = ["draft", "final"];

function valuesOf(list) {
  return list.map((x) => (typeof x === "string" ? x : x.value));
}

export function isValid(list, value) {
  return valuesOf(list).includes(value);
}
