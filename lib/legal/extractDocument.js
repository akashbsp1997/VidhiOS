// lib/legal/extractDocument.js
//
// Turns one uploaded legal/administrative document (image or PDF) into
// structured candidate fields -- ONE Gemini vision call, OCR and structuring
// combined, since most real legal documents that get photographed/scanned
// have no clean text layer for a pdf-parse-style extractor to find anyway.
// Everything returned here is a SUGGESTION the user reviews/edits before it
// ever becomes a legalCases/legalParties row (see app/legal/upload) -- never
// written directly, same "AI suggests, human commits" split as the exam-prep
// ingest pipeline (lib/ingest/structure.js).

import { callVisionForJSON } from "../ai/client.js";

const ANTI_HALLUCINATION_NOTE =
  "Only report what is actually visible/legible in the document image given to you. Do not invent case numbers, dates, names, amounts, or court names. Leave a field null (or omit an entry) rather than guess -- an honest gap is better than a fabricated fact on a real legal document.";

function buildSystem() {
  return `You read one page or document (a scanned/photographed legal or administrative paper, or a born-digital PDF) and extract its key details for someone setting up a legal case file.
${ANTI_HALLUCINATION_NOTE}

Return ONLY a JSON object, no other text, in exactly this shape:
{
  "fullText": "<your best-effort full transcription of every line of legible text on the document, in reading order -- this is a rough OCR transcript for the user's own record, not a formatted extract. Empty string if nothing is legible.>",
  "documentTitle": "<the document's own title/heading as written, or null>",
  "documentDate": "<the date the document is dated/signed, in YYYY-MM-DD if determinable, else the raw text as written, else null>",
  "docTypeGuess": "<one of: pleading, evidence, notice, judgment, order, id_proof, contract, correspondence, other>",
  "caseNumberFound": "<a case/complaint/FIR/reference number if one appears on the document, else null>",
  "courtFound": "<the court, tribunal, or authority named on the document (letterhead, cause title, or stamp), else null>",
  "parties": [ { "name": "<person or entity name as written>", "role": "<their role if stated, e.g. 'petitioner', 'landlord', 'complainant', else 'unspecified'>" } ],
  "keyDates": [ { "label": "<what this date is, e.g. 'incident date', 'notice period expires'>", "date": "<YYYY-MM-DD if determinable, else the raw text as written>" } ],
  "amounts": [ { "label": "<what this amount is, e.g. 'claimed damages', 'outstanding rent'>", "amount": <number, in the currency units as written -- omit currency symbols>, "currencyNote": "<e.g. 'INR' if stated, else null>" } ],
  "summary": "<a neutral, 2-4 sentence plain-language summary of what this document is and what it says, grounded only in its actual visible content>"
}

If the image is blank, unreadable, or not a legal/administrative document at all, still return the JSON shape above with docTypeGuess "other", empty arrays, and a summary saying so.`;
}

function clampString(value, maxLen) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLen) : null;
}

function normalizeParties(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p === "object" && typeof p.name === "string" && p.name.trim())
    .slice(0, 30)
    .map((p) => ({ name: p.name.trim().slice(0, 200), role: clampString(p.role, 60) || "unspecified" }));
}

function normalizeKeyDates(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d) => d && typeof d === "object" && typeof d.date === "string" && d.date.trim())
    .slice(0, 20)
    .map((d) => ({ label: clampString(d.label, 120) || "Date", date: d.date.trim().slice(0, 40) }));
}

function normalizeAmounts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === "object" && Number.isFinite(a.amount))
    .slice(0, 20)
    .map((a) => ({ label: clampString(a.label, 120) || "Amount", amount: a.amount, currencyNote: clampString(a.currencyNote, 20) }));
}

const VALID_DOC_TYPE_GUESSES = ["pleading", "evidence", "notice", "judgment", "order", "id_proof", "contract", "correspondence", "other"];

/**
 * `file` is { mimeType, base64 } of the raw uploaded bytes (image or PDF,
 * already confirmed present in Storage by the caller). Returns a plain
 * object matching db/schema.js's legalDocuments.extractedData shape --
 * never throws on a low-quality/unreadable image, since that's a normal
 * "extraction found little/nothing" outcome the caller surfaces via the
 * summary field, not an error (a genuine API/network failure still throws,
 * same as every other lib/ai/client.js caller).
 */
export async function extractLegalDocument(file) {
  const raw = await callVisionForJSON({
    system: buildSystem(),
    user: "Extract this document's details now. Return only the JSON object.",
    file,
    maxTokens: 4000,
  });

  return {
    fullText: typeof raw?.fullText === "string" ? raw.fullText.trim() : "",
    documentTitle: clampString(raw?.documentTitle, 300),
    documentDate: clampString(raw?.documentDate, 40),
    docTypeGuess: VALID_DOC_TYPE_GUESSES.includes(raw?.docTypeGuess) ? raw.docTypeGuess : "other",
    caseNumberFound: clampString(raw?.caseNumberFound, 100),
    courtFound: clampString(raw?.courtFound, 300),
    parties: normalizeParties(raw?.parties),
    keyDates: normalizeKeyDates(raw?.keyDates),
    amounts: normalizeAmounts(raw?.amounts),
    summary: clampString(raw?.summary, 1500) || "",
  };
}
