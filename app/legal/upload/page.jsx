"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client.js";
import { LEGAL_DOCUMENT_TYPES, LEGAL_PARTY_ROLES } from "../../../lib/legal/docTypes.js";

const BUCKET = "legal-documents";
const VALID_PARTY_ROLES = LEGAL_PARTY_ROLES.map((r) => r.value);

// The document extraction prompt (lib/legal/extractDocument.js) asks for a
// free-text role per party ("petitioner", "landlord", "complainant", ...),
// not one of legalParties' fixed role enum -- most won't match exactly.
// Falls back to "third_party" (a safe, always-valid default) rather than
// silently dropping the party, which is what happened before this existed
// (the parties POST 400s on an invalid role and the create call above
// swallows that error).
function guessPartyRole(rawRole) {
  const normalized = (rawRole || "").toLowerCase().trim();
  return VALID_PARTY_ROLES.includes(normalized) ? normalized : "third_party";
}

async function safeFetchJson(url, options) {
  const res = await fetch(url, options);
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 300) || "(empty body)"}`);
  }
}

const STATUS_COLOR = { uploaded: "var(--ink-soft)", extracted: "var(--forest)", error: "var(--maroon)" };

// Upload a photographed/scanned legal document (image or PDF) and let
// Gemini vision (lib/legal/extractDocument.js) read it in one pass -- OCR
// plus structured fields (parties, dates, amounts, case/court info). The
// user reviews the result and, with one click, spins up a new case
// pre-filled from it -- nothing here is written into a real case record
// until that click.
export default function LegalUploadPage() {
  const [docType, setDocType] = useState("evidence");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stepMsg, setStepMsg] = useState(null);
  const [error, setError] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [creatingFrom, setCreatingFrom] = useState(null);

  function loadDocuments() {
    safeFetchJson("/api/legal/documents?caseId=unassigned")
      .then((d) => !d.error && setDocuments(d.documents))
      .catch(() => {});
  }

  useEffect(loadDocuments, []);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      setStepMsg("Requesting upload URL…");
      const urlData = await safeFetchJson("/api/legal/documents/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type }),
      });
      if (urlData.error) throw new Error(urlData.error);

      setStepMsg("Uploading file…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage.from(BUCKET).uploadToSignedUrl(urlData.storagePath, urlData.token, file);
      if (uploadError) throw new Error(uploadError.message);

      setStepMsg("Reading document with AI (OCR + extraction)…");
      const finalizeData = await safeFetchJson("/api/legal/documents/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storagePath: urlData.storagePath,
          originalFilename: file.name,
          fileMimeType: file.type,
          fileSizeBytes: file.size,
          docType,
        }),
      });
      if (finalizeData.error && finalizeData.status !== "error") throw new Error(finalizeData.error);

      setStepMsg(
        finalizeData.status === "duplicate"
          ? "This exact file was already uploaded before."
          : finalizeData.status === "extracted"
          ? "Extracted successfully — see it below."
          : `Uploaded, but extraction failed: ${finalizeData.error || "unknown error"}`
      );
      setFile(null);
      loadDocuments();
    } catch (err) {
      setError(err.message);
      setStepMsg(null);
    } finally {
      setBusy(false);
    }
  }

  async function retryExtraction(id) {
    setError(null);
    try {
      const data = await safeFetchJson(`/api/legal/documents/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retryExtraction: true }),
      });
      if (data.error) throw new Error(data.error);
      loadDocuments();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createCaseFromDocument(doc) {
    setCreatingFrom(doc.id);
    setError(null);
    try {
      const d = doc.extractedData || {};
      const title = d.documentTitle || d.summary?.slice(0, 80) || doc.originalFilename;
      const caseData = await safeFetchJson("/api/legal/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          caseNumber: d.caseNumberFound || null,
          courtName: d.courtFound || null,
          description: d.summary || "",
          sourceDocumentId: doc.id,
        }),
      });
      if (caseData.error) throw new Error(caseData.error);

      // Best-effort: seed parties the AI found on the document -- a user
      // can still edit/remove/add on the case page after. Never blocks
      // navigation to the new case if one of these fails.
      for (const p of d.parties || []) {
        await safeFetchJson(`/api/legal/cases/${caseData.case.id}/parties`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: p.name, role: guessPartyRole(p.role), notes: p.role && !VALID_PARTY_ROLES.includes(p.role.toLowerCase().trim()) ? `AI-extracted role: ${p.role}` : "" }),
        }).catch(() => {});
      }

      window.location.href = `/legal/cases/${caseData.case.id}`;
    } catch (err) {
      setError(err.message);
      setCreatingFrom(null);
    }
  }

  return (
    <>
      <div className="card">
        <h1>Upload a document</h1>
        <p className="lede">Photograph or scan a document (image or PDF) — AI reads it and suggests case details for your review.</p>

        {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

        <form onSubmit={handleUpload}>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--ink-soft)" }}>Document type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", marginBottom: 12, borderRadius: 8, border: "1px solid var(--rule)" }}
          >
            {LEGAL_DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--ink-soft)" }}>Image or PDF file</label>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ width: "100%", marginBottom: 14 }}
          />

          <button className="btn btn-primary" type="submit" disabled={busy || !file} style={{ width: "100%" }}>
            {busy ? "Working…" : "Upload & extract"}
          </button>
        </form>

        {stepMsg && <div className="disclaimer" style={{ marginTop: 14 }}>{stepMsg}</div>}
      </div>

      <div className="card">
        <h2>Unattached documents</h2>
        <p className="lede">Uploaded but not yet part of a case. Review the extraction, then create a case from it or attach it to an existing one.</p>
        {!documents && <div className="loading">Loading…</div>}
        {documents && documents.length === 0 && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>Nothing here yet.</p>}
        {documents &&
          documents.map((doc) => {
            const d = doc.extractedData || {};
            return (
              <div className="source-row" key={doc.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span>{doc.originalFilename}</span>
                  <span className="source-status" style={{ color: STATUS_COLOR[doc.status] || "var(--ink-soft)" }}>{doc.status}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>{doc.docType}</div>
                {doc.status === "extracted" && (
                  <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
                    {d.documentTitle && <div><b>{d.documentTitle}</b></div>}
                    {d.summary && <div style={{ marginTop: 4 }}>{d.summary}</div>}
                    <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-soft)" }}>
                      {d.caseNumberFound && <>Case #: {d.caseNumberFound} · </>}
                      {d.courtFound && <>Court/authority: {d.courtFound} · </>}
                      {(d.parties || []).length > 0 && <>Parties found: {d.parties.map((p) => p.name).join(", ")}</>}
                    </div>
                  </div>
                )}
                {doc.status === "error" && <div style={{ fontSize: 12, color: "var(--maroon)", marginTop: 6 }}>{doc.errorMsg}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {doc.status === "error" && (
                    <button className="btn" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => retryExtraction(doc.id)}>
                      Retry extraction
                    </button>
                  )}
                  {doc.status === "extracted" && (
                    <button
                      className="btn btn-primary"
                      style={{ padding: "6px 12px", fontSize: 13 }}
                      onClick={() => createCaseFromDocument(doc)}
                      disabled={creatingFrom === doc.id}
                    >
                      {creatingFrom === doc.id ? "Creating…" : "Create case from this →"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}
