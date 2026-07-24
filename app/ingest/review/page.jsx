"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Editable field lists per itemType -- drives both the input rendered and
// how its value is parsed back out of the (string) input. Matches the exact
// shapes lib/ingest/config.js's prompts ask the AI for and lib/ingest/commit.js
// expects on approve.
const FIELD_SETS = {
  subtopic: [
    { key: "existingSubtopicId", label: "Existing subtopic id (leave blank if new)", type: "text" },
    { key: "suggestedId", label: "New subtopic id (if no existing match)", type: "text" },
    { key: "paper", label: "Paper", type: "number" },
    { key: "section", label: "Section", type: "text" },
    { key: "topicText", label: "Topic text", type: "textarea" },
  ],
  pyq: [
    { key: "suggestedId", label: "PYQ id", type: "text" },
    { key: "year", label: "Year", type: "number" },
    { key: "paper", label: "Paper", type: "number" },
    { key: "slot", label: "Question #", type: "number" },
    { key: "sec", label: "Section (A/B)", type: "text" },
    { key: "sub", label: "Sub-part (a-e)", type: "text" },
    { key: "marks", label: "Marks", type: "number" },
    { key: "questionText", label: "Question text", type: "textarea" },
    { key: "matchedTopics", label: "Matched subtopic ids (comma-separated)", type: "list" },
    { key: "newTopicSuggestion", label: "New topic suggestion (if unmatched)", type: "text" },
  ],
  source: [
    { key: "matchedSubtopicId", label: "Matched subtopic id (must already exist)", type: "text" },
    { key: "newSubtopicSuggestion", label: "New subtopic suggestion (not auto-created)", type: "text" },
    { key: "title", label: "Title", type: "text" },
    { key: "sourceType", label: "Source type", type: "text" },
    { key: "excerptText", label: "Excerpt text", type: "textarea" },
  ],
};

// Only relevant to an ncert_chapter upload -- the AI's suggested book/
// chapter/subject/class, verified by the operator here before commit like
// every other suggested field (see lib/ingest/config.js's
// buildNcertSourceSystem). ncertClass directly drives
// lib/adaptive/unlocks.js's basics-to-advanced scoring once approved.
const NCERT_SOURCE_FIELDS = [
  { key: "bookName", label: "NCERT book name", type: "text" },
  { key: "chapterName", label: "Chapter name", type: "text" },
  { key: "ncertSubject", label: "NCERT subject (e.g. Political Science, History)", type: "text" },
  { key: "ncertClass", label: "Class (6-12)", type: "number" },
];

function parseFieldValue(type, raw) {
  if (type === "number") return raw === "" ? null : Number(raw);
  if (type === "list") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw === "" ? null : raw;
}

function fieldDisplayValue(type, value) {
  if (value === null || value === undefined) return "";
  if (type === "list") return Array.isArray(value) ? value.join(", ") : "";
  return String(value);
}

// A server crash/timeout returns an HTML/plain-text error page, not our
// JSON shape -- reading the body as text first (rather than res.json()
// directly) means a failure like that surfaces its real content instead of
// a bare, unhelpful "Unexpected token... is not valid JSON".
async function safeFetchJson(url, options) {
  const res = await fetch(url, options);
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 300) || "(empty body)"}`);
  }
}

export default function IngestReviewPage() {
  const searchParams = useSearchParams();
  const key = searchParams.get("key") || "";

  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [edits, setEdits] = useState({}); // itemId -> partial data overrides
  const [busyId, setBusyId] = useState(null);
  const [actionErrors, setActionErrors] = useState({}); // itemId -> message
  // Bulk-approve progress (see bulkApproveHighConfidence below) -- separate
  // from busyId/actionErrors, which track one-at-a-time manual actions.
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total }
  const [bulkSummary, setBulkSummary] = useState(null);

  function load() {
    safeFetchJson(`/api/ingest/review?key=${encodeURIComponent(key)}`)
      .then((d) => (d.error ? setError(d.error) : setItems(d.items)))
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (key) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function currentData(item) {
    return { ...(item.finalData || item.suggestedData), ...(edits[item.id] || {}) };
  }

  function setField(itemId, key2, type, raw) {
    setEdits((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), [key2]: parseFieldValue(type, raw) } }));
  }

  async function act(item, action) {
    setBusyId(item.id);
    setActionErrors((prev) => ({ ...prev, [item.id]: undefined }));
    const hasEdits = edits[item.id] && Object.keys(edits[item.id]).length > 0;
    try {
      const data = await safeFetchJson(`/api/ingest/review/action?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, action, editedData: hasEdits ? currentData(item) : undefined }),
      });
      if (data.error) {
        setActionErrors((prev) => ({ ...prev, [item.id]: data.error }));
      } else {
        load();
      }
    } catch (err) {
      setActionErrors((prev) => ({ ...prev, [item.id]: err.message }));
    } finally {
      setBusyId(null);
    }
  }

  // Approves every currently-listed high-confidence item, sequentially
  // (one commit at a time, same as a manual click would do) -- reuses the
  // exact same /api/ingest/review/action endpoint act() uses above, but
  // calls it directly instead of going through act() so this doesn't
  // reload the full item list after every single approval (wasteful at
  // real batch sizes -- hundreds of items would mean hundreds of reloads).
  // A per-item commit failure (e.g. an unmatched source excerpt) is left
  // pending with its real commitError, same as the manual flow -- surfaced
  // once the single reload at the end picks it back up.
  async function bulkApproveHighConfidence() {
    const eligible = items.filter((item) => currentData(item).confidence === "high");
    if (!eligible.length) return;
    setBulkRunning(true);
    setBulkSummary(null);
    let approved = 0;
    for (let i = 0; i < eligible.length; i++) {
      setBulkProgress({ done: i, total: eligible.length });
      const item = eligible[i];
      const hasEdits = edits[item.id] && Object.keys(edits[item.id]).length > 0;
      try {
        const data = await safeFetchJson(`/api/ingest/review/action?key=${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemId: item.id, action: "approve", editedData: hasEdits ? currentData(item) : undefined }),
        });
        if (data.ok) approved++;
      } catch {
        // left pending -- the reload below will show its real state
      }
    }
    setBulkProgress({ done: eligible.length, total: eligible.length });
    setBulkSummary(
      `Approved ${approved} of ${eligible.length} high-confidence item(s).` +
        (approved < eligible.length ? " The rest are still pending — check their error message below." : "")
    );
    setBulkRunning(false);
    load();
  }

  if (!key) {
    return (
      <div className="card">
        <h1>Review content</h1>
        <div className="error-box">
          Missing <code>?key=</code>. Visit this page as <code>/ingest/review?key=YOUR_SETUP_SECRET</code>.
        </div>
      </div>
    );
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!items) return <div className="loading">Loading…</div>;

  const highConfidenceCount = items.filter((item) => currentData(item).confidence === "high").length;

  return (
    <div className="card">
      <h1>Review content</h1>
      <p className="lede">Edit anything that's wrong, then approve or reject. Nothing here is live until you approve it.</p>

      {highConfidenceCount > 0 && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 13 }}>
            {bulkSummary ?? `${highConfidenceCount} item(s) are high-confidence -- approve them all at once instead of one by one.`}
            {bulkRunning && bulkProgress && ` (${bulkProgress.done}/${bulkProgress.total})`}
          </span>
          <button className="btn btn-primary" onClick={bulkApproveHighConfidence} disabled={bulkRunning}>
            {bulkRunning ? "Approving…" : `Approve all high-confidence (${highConfidenceCount})`}
          </button>
        </div>
      )}

      {items.length === 0 && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>Nothing pending review.</p>}

      {items.map((item) => {
        const data = currentData(item);
        const fields = [
          ...(FIELD_SETS[item.itemType] || []),
          ...(item.itemType === "source" && item.upload.docType === "ncert_chapter" ? NCERT_SOURCE_FIELDS : []),
        ];
        return (
          <div className="card" key={item.id} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span className="meta-line" style={{ marginBottom: 0 }}>
                {item.itemType} · {item.upload.originalFilename} · {item.upload.subjectId}
              </span>
              <span className="source-status" style={{ color: data.confidence === "high" ? "var(--forest)" : data.confidence === "low" ? "var(--maroon)" : "var(--ink-soft)" }}>
                {data.confidence || "—"} confidence
              </span>
            </div>
            {item.upload.sourceUrl && (
              <p style={{ fontSize: 12.5, marginBottom: 10 }}>
                <a href={item.upload.sourceUrl} target="_blank" rel="noreferrer">
                  Check the original source →
                </a>
              </p>
            )}

            {item.itemType === "source" && !data.matchedSubtopicId && (
              <div className="disclaimer" style={{ marginBottom: 10 }}>
                No existing subtopic matched{data.newSubtopicSuggestion ? ` — AI suggests: "${data.newSubtopicSuggestion}"` : ""}.
                Fill in "Matched subtopic id" with a real existing id before approving, or create that subtopic first (e.g. via a
                syllabus item) and come back.
              </div>
            )}

            {fields.map((f) => (
              <div key={f.key} style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 12.5, marginBottom: 3, color: "var(--ink-soft)" }}>{f.label}</label>
                {f.type === "textarea" ? (
                  <textarea
                    value={fieldDisplayValue(f.type, data[f.key])}
                    onChange={(e) => setField(item.id, f.key, f.type, e.target.value)}
                    rows={f.key === "excerptText" ? 6 : 3}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--rule)", fontFamily: "inherit", fontSize: 13.5 }}
                  />
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    value={fieldDisplayValue(f.type, data[f.key])}
                    onChange={(e) => setField(item.id, f.key, f.type, e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--rule)", fontSize: 13.5 }}
                  />
                )}
              </div>
            ))}

            {data.notes && (
              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", fontStyle: "italic", marginBottom: 10 }}>AI notes: {data.notes}</p>
            )}

            {(item.commitError || actionErrors[item.id]) && (
              <div className="error-box" style={{ marginBottom: 10 }}>{actionErrors[item.id] || item.commitError}</div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => act(item, "approve")} disabled={busyId === item.id || bulkRunning}>
                {busyId === item.id ? "Working…" : (item.commitError ? "Retry approve" : "Approve")}
              </button>
              <button className="btn" onClick={() => act(item, "reject")} disabled={busyId === item.id || bulkRunning}>
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
