"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "../../../lib/supabase/client.js";

const DOC_TYPES = [
  { value: "syllabus", label: "Syllabus" },
  { value: "pyq_paper", label: "PYQ paper" },
  { value: "ncert_chapter", label: "NCERT chapter" },
  { value: "newspaper_clipping", label: "Newspaper / current-affairs clipping" },
  { value: "external_source", label: "External source (govt report, reference book, etc.)" },
];

const STATUS_COLOR = {
  uploaded: "var(--ink-soft)",
  extracted: "var(--forest)",
  needs_ocr: "var(--maroon)",
  duplicate: "var(--ink-soft)",
  error: "var(--maroon)",
  structured: "var(--forest)",
};

// A server crash/timeout returns an HTML/plain-text error page, not our
// JSON shape -- reading the body as text first and parsing that (rather
// than calling res.json() directly) means a failure like that surfaces its
// real content instead of a bare, unhelpful "Unexpected token... is not
// valid JSON".
async function safeFetchJson(url, options) {
  const res = await fetch(url, options);
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 300) || "(empty body)"}`);
  }
}

// Admin-only upload page for the Phase 2 content-ingestion pipeline (see
// docs/ARCHITECTURE.md) -- reads ?key= from its own URL the same way
// app/login/page.jsx reads ?next=, and appends it to every /api/ingest/*
// call. Bookmarkable: visit /ingest/upload?key=YOUR_SETUP_SECRET once. Sits
// behind the normal Supabase-login gate (middleware.js) like the rest of
// the app; only the underlying API calls are SETUP_SECRET-gated.
export default function IngestUploadPage() {
  const searchParams = useSearchParams();
  const key = searchParams.get("key") || "";

  const [docType, setDocType] = useState("syllabus");
  const [subjectId, setSubjectId] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [mode, setMode] = useState("file"); // 'file' | 'url'
  const [file, setFile] = useState(null);
  const [sourceUrlInput, setSourceUrlInput] = useState("");
  const [stepMsg, setStepMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState(null);
  const [uploadsError, setUploadsError] = useState(null);

  useEffect(() => {
    safeFetchJson("/api/subjects")
      .then((d) => {
        if (d.subjects) {
          setSubjects(d.subjects);
          if (d.subjects.length && !subjectId) setSubjectId(d.subjects[0].id);
        }
      })
      .catch(() => {}); // subject dropdown just stays empty; not worth a page-level error for this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [structuringId, setStructuringId] = useState(null);
  const [structureResult, setStructureResult] = useState({}); // uploadId -> { itemCount, textTruncatedForAi } | { error }
  // Distinct from structuringId -- that's "one chunk in flight" (a single
  // click), this is "the auto-advance loop below is running" (many chunks,
  // one after another). Both gate the same buttons so a manual click can't
  // race an auto-run for the same upload.
  const [autoStructuringId, setAutoStructuringId] = useState(null);

  function loadUploads() {
    safeFetchJson(`/api/ingest/uploads?key=${encodeURIComponent(key)}`)
      .then((d) => (d.error ? setUploadsError(d.error) : setUploads(d.uploads)))
      .catch((e) => setUploadsError(e.message));
  }

  useEffect(() => {
    if (key) loadUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function structureOneChunk(uploadId) {
    const data = await safeFetchJson(`/api/ingest/structure?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId }),
    });
    setStructureResult((prev) => ({ ...prev, [uploadId]: data.error ? { error: data.error } : data }));
    return data;
  }

  async function structureNow(uploadId) {
    setStructuringId(uploadId);
    setStructureResult((prev) => ({ ...prev, [uploadId]: undefined }));
    try {
      await structureOneChunk(uploadId);
      loadUploads();
    } catch (err) {
      setStructureResult((prev) => ({ ...prev, [uploadId]: { error: err.message } }));
    } finally {
      setStructuringId(null);
    }
  }

  // Loops structureOneChunk until the document's last chunk comes back
  // done:true, instead of requiring one click per ~15-40k-character section
  // -- the real bottleneck at real-document-batch scale (a single NCERT
  // textbook or PYQ compilation can be a dozen-plus chunks). Each call
  // already reads the upload's chunksProcessed fresh from the DB, so
  // sequential awaited calls are safe -- no risk of skipping or repeating a
  // section. Stops (rather than retrying) on the first error, same as a
  // manual click would leave it -- the upload's status becomes "error" and
  // the existing "Retry structuring" button picks up from there.
  async function structureAll(uploadId) {
    setAutoStructuringId(uploadId);
    try {
      let done = false;
      while (!done) {
        const data = await structureOneChunk(uploadId);
        if (data.error) break;
        done = data.done;
      }
    } catch (err) {
      setStructureResult((prev) => ({ ...prev, [uploadId]: { error: err.message } }));
    } finally {
      setAutoStructuringId(null);
      loadUploads();
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file || !subjectId) return;
    setError(null);
    setBusy(true);
    try {
      setStepMsg("Requesting upload URL…");
      const urlData = await safeFetchJson(`/api/ingest/upload-url?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docType, subjectId, filename: file.name }),
      });
      if (urlData.error) throw new Error(urlData.error);

      setStepMsg("Uploading PDF…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("ingest-uploads")
        .uploadToSignedUrl(urlData.storagePath, urlData.token, file);
      if (uploadError) throw new Error(uploadError.message);

      setStepMsg("Extracting text…");
      const finalizeData = await safeFetchJson(`/api/ingest/finalize-upload?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType,
          subjectId,
          storagePath: urlData.storagePath,
          originalFilename: file.name,
          fileSizeBytes: file.size,
        }),
      });
      if (finalizeData.error) throw new Error(finalizeData.error);

      setStepMsg(
        finalizeData.status === "duplicate"
          ? "Already uploaded before — this is an exact duplicate of an earlier upload."
          : finalizeData.status === "needs_ocr"
          ? `Extracted ~${finalizeData.charsPerPage} chars/page — too low to be a real text layer. This looks like a scanned/image PDF; OCR isn't supported yet.`
          : `Extracted ${finalizeData.charsPerPage} chars/page across ${finalizeData.pageCount} page(s).`
      );
      setFile(null);
      loadUploads();
    } catch (err) {
      setError(err.message);
      setStepMsg(null);
    } finally {
      setBusy(false);
    }
  }

  // For content that's already publicly hosted (e.g. an NCERT PDF on
  // ncert.nic.in) -- fetches server-side instead of making the operator
  // download-then-reupload. One step, unlike the file-upload flow, since
  // there's no browser-to-Storage leg here.
  async function handleFetchUrl(e) {
    e.preventDefault();
    if (!sourceUrlInput || !subjectId) return;
    setError(null);
    setBusy(true);
    try {
      setStepMsg("Fetching and extracting…");
      const data = await safeFetchJson(`/api/ingest/fetch-url?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docType, subjectId, url: sourceUrlInput }),
      });
      if (data.error) throw new Error(data.error);

      setStepMsg(
        data.status === "duplicate"
          ? "Already fetched before — this is an exact duplicate of an earlier upload."
          : data.status === "needs_ocr"
          ? `Extracted ~${data.charsPerPage} chars/page — too low to be a real text layer. This looks like a scanned/image PDF; OCR isn't supported yet.`
          : `Extracted ${data.charsPerPage} chars/page across ${data.pageCount} page(s).`
      );
      setSourceUrlInput("");
      loadUploads();
    } catch (err) {
      setError(err.message);
      setStepMsg(null);
    } finally {
      setBusy(false);
    }
  }

  if (!key) {
    return (
      <div className="card">
        <h1>Upload content</h1>
        <div className="error-box">
          Missing <code>?key=</code>. Visit this page as <code>/ingest/upload?key=YOUR_SETUP_SECRET</code>.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1>Upload content</h1>
          <a href={`/ingest/review?key=${encodeURIComponent(key)}`} style={{ fontSize: 13.5 }}>
            Review pending →
          </a>
        </div>
        <p className="lede">Syllabus, PYQ papers, NCERT chapters, or newspaper clippings — text-layer PDFs only for now.</p>

        {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            className="btn"
            style={mode === "file" ? { borderColor: "var(--leather)" } : {}}
            onClick={() => setMode("file")}
          >
            Upload a file
          </button>
          <button
            type="button"
            className="btn"
            style={mode === "url" ? { borderColor: "var(--leather)" } : {}}
            onClick={() => setMode("url")}
          >
            Fetch from a URL
          </button>
        </div>

        <form onSubmit={mode === "file" ? handleUpload : handleFetchUrl}>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--ink-soft)" }}>Document type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", marginBottom: 12, borderRadius: 8, border: "1px solid var(--rule)" }}
          >
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--ink-soft)" }}>Subject</label>
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", marginBottom: 12, borderRadius: 8, border: "1px solid var(--rule)" }}
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>

          {mode === "file" ? (
            <>
              <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--ink-soft)" }}>PDF file</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ width: "100%", marginBottom: 14 }}
              />
            </>
          ) : (
            <>
              <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--ink-soft)" }}>
                Public PDF URL (e.g. an NCERT textbook page)
              </label>
              <input
                type="url"
                placeholder="https://ncert.nic.in/textbook/pdf/..."
                value={sourceUrlInput}
                onChange={(e) => setSourceUrlInput(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", marginBottom: 14, borderRadius: 8, border: "1px solid var(--rule)" }}
              />
            </>
          )}

          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !subjectId || (mode === "file" ? !file : !sourceUrlInput)}
            style={{ width: "100%" }}
          >
            {busy ? "Working…" : mode === "file" ? "Upload" : "Fetch"}
          </button>
        </form>

        {stepMsg && <div className="disclaimer" style={{ marginTop: 14 }}>{stepMsg}</div>}
      </div>

      <div className="card">
        <h2>Recent uploads</h2>
        {uploadsError && <div className="error-box">{uploadsError}</div>}
        {!uploads && !uploadsError && <div className="loading">Loading…</div>}
        {uploads && uploads.length === 0 && (
          <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>No uploads yet.</p>
        )}
        {uploads &&
          uploads.map((u) => (
            <div className="source-row" key={u.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span>{u.originalFilename}</span>
                <span className="source-status" style={{ color: STATUS_COLOR[u.status] || "var(--ink-soft)" }}>
                  {u.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>
                {u.docType} · {u.subjectId}
                {u.charsPerPage != null ? ` · ${u.charsPerPage} chars/page` : ""}
                {u.pageCount ? ` · ${u.pageCount} page(s)` : ""}
                {u.totalChunks > 1
                  ? u.status === "structured"
                    ? ` · ${u.totalChunks} of ${u.totalChunks} sections`
                    : ` · section ${u.chunksProcessed + 1} of ${u.totalChunks}`
                  : ""}
                {u.sourceUrl && (
                  <>
                    {" · "}
                    <a href={u.sourceUrl} target="_blank" rel="noreferrer">
                      verify source
                    </a>
                  </>
                )}
              </div>
              {u.errorMsg && <div style={{ fontSize: 12, color: "var(--maroon)", marginTop: 3 }}>{u.errorMsg}</div>}
              {u.status === "needs_ocr" && (
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>
                  Scanned/image PDF — text extraction too low to process. OCR isn't supported yet.
                </div>
              )}
              {(u.status === "extracted" || u.status === "error") && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    style={{ padding: "6px 12px", fontSize: 13 }}
                    onClick={() => structureNow(u.id)}
                    disabled={structuringId === u.id || autoStructuringId === u.id}
                  >
                    {structuringId === u.id
                      ? "Structuring…"
                      : u.status === "error"
                      ? "Retry structuring"
                      : u.chunksProcessed > 0
                      ? `Structure next section (${u.chunksProcessed + 1} of ${u.totalChunks})`
                      : "Structure with AI"}
                  </button>
                  <button
                    className="btn"
                    style={{ padding: "6px 12px", fontSize: 13 }}
                    onClick={() => structureAll(u.id)}
                    disabled={structuringId === u.id || autoStructuringId === u.id}
                    title="Runs every remaining section one after another, no need to click per section"
                  >
                    {autoStructuringId === u.id ? "Auto-structuring… (see progress below)" : "Structure all sections"}
                  </button>
                </div>
              )}
              {structureResult[u.id] &&
                (structureResult[u.id].error ? (
                  <div style={{ fontSize: 12, color: "var(--maroon)", marginTop: 6 }}>{structureResult[u.id].error}</div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--forest)", marginTop: 6 }}>
                    {structureResult[u.id].itemCount} candidate item(s) from section {structureResult[u.id].chunkIndex + 1} of{" "}
                    {structureResult[u.id].totalChunks}.
                    {structureResult[u.id].done
                      ? " All sections done — ready for review."
                      : ` ${structureResult[u.id].totalChunks - structureResult[u.id].chunksProcessed} section(s) left.`}
                  </div>
                ))}
              {u.status === "structured" && !structureResult[u.id] && (
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>
                  Already structured —{" "}
                  <a href={`/ingest/review?key=${encodeURIComponent(key)}`}>review candidates</a>.
                </div>
              )}
            </div>
          ))}
      </div>
    </>
  );
}
