"use client";

import { useEffect, useState } from "react";
import { LEGAL_CASE_TYPES } from "../../lib/legal/docTypes.js";

function caseTypeLabel(value) {
  return LEGAL_CASE_TYPES.find((t) => t.value === value)?.label || value;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_COLOR = {
  draft: "var(--ink-soft)",
  active: "var(--forest)",
  stayed: "var(--brass)",
  disposed: "var(--ink-soft)",
  closed: "var(--ink-soft)",
};

// Entry point for the Legal Case Manager -- a self-contained second product
// living alongside the exam-prep app (see db/schema.js's "Legal Case
// Manager" section header). Lists the user's cases and upcoming dates, with
// the two ways to start: upload a document (AI extracts details to seed a
// case) or create one by hand.
export default function LegalDashboard() {
  const [cases, setCases] = useState(null);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/legal/cases")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setCases(d.cases)))
      .catch((e) => setError(e.message));
    fetch("/api/legal/events")
      .then((r) => r.json())
      .then((d) => !d.error && setEvents(d.events))
      .catch(() => {});
  }, []);

  return (
    <>
      <h1>Legal Case Manager</h1>
      <p className="lede">
        Upload a document to extract case details automatically, or start a case by hand — then track parties, pick a
        forum, follow dates, and draft filings, all in one place.
      </p>

      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a className="btn btn-primary" href="/legal/upload">
          Upload a document →
        </a>
        <a className="btn" href="/legal/cases/new">
          Create a case by hand →
        </a>
      </div>

      {events && events.length > 0 && (
        <div className="card">
          <h2>Upcoming dates</h2>
          {events.slice(0, 8).map((e) => (
            <div className="source-row" key={e.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <a href={`/legal/cases/${e.caseId}`}>{e.title}</a>
                <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{formatDate(e.eventDate)}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>
                {e.eventType.replace(/_/g, " ")} · {e.caseTitle}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Your cases</h2>
        {!cases && !error && <div className="loading">Loading…</div>}
        {cases && cases.length === 0 && (
          <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>No cases yet — upload a document or create one by hand above.</p>
        )}
        {cases &&
          cases.map((c) => (
            <a href={`/legal/cases/${c.id}`} key={c.id} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
              <div className="case-card">
                <div className="case-name">{c.title}</div>
                <div className="case-field">
                  <span className="case-field-label">Type</span>
                  {caseTypeLabel(c.caseType)}
                </div>
                <div className="case-field">
                  <span className="case-field-label">Status</span>
                  <span style={{ color: STATUS_COLOR[c.status] || "inherit" }}>{c.status}</span>
                </div>
                {c.courtName && (
                  <div className="case-field">
                    <span className="case-field-label">Forum</span>
                    {c.courtName}
                  </div>
                )}
                {c.caseNumber && (
                  <div className="case-field">
                    <span className="case-field-label">Case no.</span>
                    {c.caseNumber}
                  </div>
                )}
              </div>
            </a>
          ))}
      </div>
    </>
  );
}
