"use client";

import { useEffect, useState, use as usePromise } from "react";
import CollapsibleSection from "../../../../components/CollapsibleSection.jsx";
import {
  LEGAL_CASE_TYPES,
  LEGAL_CASE_STATUSES,
  LEGAL_PARTY_ROLES,
  LEGAL_PARTY_TYPES,
  LEGAL_EVENT_TYPES,
  LEGAL_EVENT_STATUSES,
  LEGAL_DRAFT_TYPES,
} from "../../../../lib/legal/docTypes.js";

const inputStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--rule)", fontSize: 13.5 };
const labelStyle = { display: "block", fontSize: 12, marginBottom: 3, color: "var(--ink-soft)" };

async function safeFetchJson(url, options) {
  const res = await fetch(url, options);
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 300) || "(empty body)"}`);
  }
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------- Overview

function OverviewSection({ caseData, onUpdated }) {
  const [form, setForm] = useState(caseData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await safeFetchJson(`/api/legal/cases/${caseData.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          caseType: form.caseType,
          status: form.status,
          caseNumber: form.caseNumber,
          courtName: form.courtName,
          jurisdictionState: form.jurisdictionState,
          subjectMatter: form.subjectMatter,
          causeOfAction: form.causeOfAction,
          claimAmount: form.claimAmount === "" || form.claimAmount == null ? null : Number(form.claimAmount),
          filingDate: form.filingDate,
          description: form.description,
        }),
      });
      if (data.error) throw new Error(data.error);
      onUpdated(data.case);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Overview</h2>
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Title</label>
          <input style={{ ...inputStyle, width: "100%" }} value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Case type</label>
          <select style={{ ...inputStyle, width: "100%" }} value={form.caseType} onChange={(e) => set("caseType", e.target.value)}>
            {LEGAL_CASE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select style={{ ...inputStyle, width: "100%" }} value={form.status} onChange={(e) => set("status", e.target.value)}>
            {LEGAL_CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Case/complaint number</label>
          <input style={{ ...inputStyle, width: "100%" }} value={form.caseNumber || ""} onChange={(e) => set("caseNumber", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Court / forum (specific bench)</label>
          <input style={{ ...inputStyle, width: "100%" }} value={form.courtName || ""} onChange={(e) => set("courtName", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Jurisdiction (state)</label>
          <input style={{ ...inputStyle, width: "100%" }} value={form.jurisdictionState || ""} onChange={(e) => set("jurisdictionState", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Subject matter tag</label>
          <input style={{ ...inputStyle, width: "100%" }} value={form.subjectMatter || ""} onChange={(e) => set("subjectMatter", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Claim amount (₹)</label>
          <input
            style={{ ...inputStyle, width: "100%" }}
            type="number"
            value={form.claimAmount ?? ""}
            onChange={(e) => set("claimAmount", e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Filing date</label>
          <input
            style={{ ...inputStyle, width: "100%" }}
            type="date"
            value={form.filingDate ? form.filingDate.slice(0, 10) : ""}
            onChange={(e) => set("filingDate", e.target.value)}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Cause of action</label>
          <input style={{ ...inputStyle, width: "100%" }} value={form.causeOfAction || ""} onChange={(e) => set("causeOfAction", e.target.value)} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, width: "100%", minHeight: 80 }} value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
        </div>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Parties

function PartiesSection({ caseId, parties, onChanged }) {
  const [form, setForm] = useState({ name: "", role: "petitioner", partyType: "individual", advocateName: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function addParty(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await safeFetchJson(`/api/legal/cases/${caseId}/parties`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (data.error) throw new Error(data.error);
      setForm({ name: "", role: "petitioner", partyType: "individual", advocateName: "" });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeParty(id) {
    await safeFetchJson(`/api/legal/parties/${id}`, { method: "DELETE" }).catch(() => {});
    onChanged();
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Parties</h2>
      {error && <div className="error-box">{error}</div>}
      {parties.length === 0 && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>No parties added yet.</p>}
      {parties.map((p) => (
        <div className="source-row" key={p.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>
              <b>{p.name}</b> — {p.role.replace(/_/g, " ")} ({p.partyType})
            </span>
            <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => removeParty(p.id)}>
              Remove
            </button>
          </div>
          {p.advocateName && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>Advocate: {p.advocateName}</div>}
          {p.notes && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>{p.notes}</div>}
        </div>
      ))}

      <form onSubmit={addParty} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <input style={{ ...inputStyle, gridColumn: "1 / -1" }} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select style={inputStyle} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {LEGAL_PARTY_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select style={inputStyle} value={form.partyType} onChange={(e) => setForm({ ...form, partyType: e.target.value })}>
          {LEGAL_PARTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          style={{ ...inputStyle, gridColumn: "1 / -1" }}
          placeholder="Advocate name (optional)"
          value={form.advocateName}
          onChange={(e) => setForm({ ...form, advocateName: e.target.value })}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !form.name.trim()} style={{ gridColumn: "1 / -1" }}>
          {busy ? "Adding…" : "Add party"}
        </button>
      </form>
    </div>
  );
}

// -------------------------------------------------------------------- Forum

function ForumSection({ caseId, forum, onChanged }) {
  const [recs, setRecs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function loadRecs() {
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetchJson(`/api/legal/cases/${caseId}/forum-recommend`);
      if (data.error) throw new Error(data.error);
      setRecs(data.recommendations);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function selectForum(forumId) {
    await safeFetchJson(`/api/legal/cases/${caseId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forumId }),
    }).catch(() => {});
    onChanged();
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Forum selection</h2>
      {forum ? (
        <div className="case-card" style={{ marginBottom: 12 }}>
          <div className="case-name">{forum.name}</div>
          <div className="case-field">
            <span className="case-field-label">Type</span>
            {forum.forumType.replace(/_/g, " ")} · {forum.level}
          </div>
          {forum.description && <div className="case-field">{forum.description}</div>}
          {forum.notes && (
            <div className="disclaimer" style={{ marginTop: 8 }}>
              {forum.notes}
            </div>
          )}
          <button className="btn" style={{ marginTop: 8, padding: "6px 12px", fontSize: 13 }} onClick={() => selectForum(null)}>
            Unset forum
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>No forum chosen yet.</p>
      )}

      {error && <div className="error-box">{error}</div>}
      <button className="btn" onClick={loadRecs} disabled={loading}>
        {loading ? "Scoring…" : "Get forum suggestions"}
      </button>
      <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}>
        Rule-based, from case type/subject/claim amount against a general Indian forum catalog — always verify against current local rules before filing.
      </p>

      {recs && (
        <div style={{ marginTop: 10 }}>
          {recs.slice(0, 8).map(({ forum: f, score, reasons, eligible }) => (
            <div className="source-row" key={f.id} style={{ opacity: eligible ? 1 : 0.55 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span>
                  <b>{f.name}</b> <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>({f.level})</span>
                </span>
                <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => selectForum(f.id)}>
                  Select
                </button>
              </div>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--ink-soft)" }}>
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- Dates

function DatesSection({ caseId, events, onChanged }) {
  const [form, setForm] = useState({ title: "", eventType: "hearing", eventDate: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function addEvent(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.eventDate) return;
    setBusy(true);
    setError(null);
    try {
      const data = await safeFetchJson(`/api/legal/cases/${caseId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (data.error) throw new Error(data.error);
      setForm({ title: "", eventType: "hearing", eventDate: "", description: "" });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id, status) {
    await safeFetchJson(`/api/legal/events/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
    onChanged();
  }

  async function removeEvent(id) {
    await safeFetchJson(`/api/legal/events/${id}`, { method: "DELETE" }).catch(() => {});
    onChanged();
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Dates</h2>
      {error && <div className="error-box">{error}</div>}
      {events.length === 0 && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>No dates tracked yet.</p>}
      {events.map((ev) => (
        <div className="source-row" key={ev.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>
              <b>{ev.title}</b> <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>({ev.eventType.replace(/_/g, " ")})</span>
            </span>
            <span style={{ fontSize: 12.5 }}>{formatDate(ev.eventDate)}</span>
          </div>
          {ev.description && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>{ev.description}</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {LEGAL_EVENT_STATUSES.map((s) => (
              <button
                key={s}
                className="btn"
                style={{ padding: "4px 10px", fontSize: 11.5, borderColor: ev.status === s ? "var(--leather)" : undefined }}
                onClick={() => setStatus(ev.id, s)}
              >
                {s}
              </button>
            ))}
            <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, marginLeft: "auto" }} onClick={() => removeEvent(ev.id)}>
              Remove
            </button>
          </div>
        </div>
      ))}

      <form onSubmit={addEvent} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <input style={{ ...inputStyle, gridColumn: "1 / -1" }} placeholder="Title (e.g. First hearing)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <select style={inputStyle} value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })}>
          {LEGAL_EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input style={inputStyle} type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
        <input
          style={{ ...inputStyle, gridColumn: "1 / -1" }}
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !form.title.trim() || !form.eventDate} style={{ gridColumn: "1 / -1" }}>
          {busy ? "Adding…" : "Add date"}
        </button>
      </form>
    </div>
  );
}

// --------------------------------------------------------------- Documents

function DocumentsSection({ caseId, documents, onChanged }) {
  const [unassigned, setUnassigned] = useState(null);

  async function loadUnassigned() {
    const data = await safeFetchJson("/api/legal/documents?caseId=unassigned").catch(() => null);
    if (data && !data.error) setUnassigned(data.documents);
  }

  async function attach(docId) {
    await safeFetchJson(`/api/legal/documents/${docId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId }),
    }).catch(() => {});
    onChanged();
    loadUnassigned();
  }

  async function openDocument(docId) {
    const data = await safeFetchJson(`/api/legal/documents/${docId}`).catch(() => null);
    if (data?.url) window.open(data.url, "_blank", "noreferrer");
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Documents</h2>
      {documents.length === 0 && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>No documents attached yet.</p>}
      {documents.map((doc) => (
        <div className="source-row" key={doc.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>{doc.originalFilename}</span>
            <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => openDocument(doc.id)}>
              View
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>
            {doc.docType} · {doc.status}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <a className="btn btn-primary" href="/legal/upload">
          Upload a new document →
        </a>
        <button className="btn" onClick={loadUnassigned}>
          Attach an existing unattached document
        </button>
      </div>

      {unassigned && (
        <div style={{ marginTop: 10 }}>
          {unassigned.length === 0 && <p style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>No unattached documents.</p>}
          {unassigned.map((doc) => (
            <div className="source-row" key={doc.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span>{doc.originalFilename}</span>
                <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => attach(doc.id)}>
                  Attach
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Drafts

function DraftEditor({ draft, onChanged }) {
  const [content, setContent] = useState(draft.content);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [versions, setVersions] = useState(null);

  async function saveContent() {
    setBusy(true);
    setError(null);
    try {
      const data = await safeFetchJson(`/api/legal/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, editSummary: "Manual edit" }),
      });
      if (data.error) throw new Error(data.error);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const data = await safeFetchJson(`/api/legal/drafts/${draft.id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instructions }),
      });
      if (data.error) throw new Error(data.error);
      setContent(data.draft.content);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadVersions() {
    const data = await safeFetchJson(`/api/legal/drafts/${draft.id}`).catch(() => null);
    if (data && !data.error) setVersions(data.versions);
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--rule)" }}>
      {error && <div className="error-box">{error}</div>}
      <div className="disclaimer" style={{ marginBottom: 8 }}>
        {draft.generatedByAi
          ? "AI-generated — review carefully and have a qualified advocate check it before relying on or filing it."
          : "Draft the text yourself, or let AI generate/update it below."}
      </div>
      <textarea
        style={{ width: "100%", minHeight: 260, padding: 10, borderRadius: 8, border: "1px solid var(--rule)", fontFamily: "var(--font-mono)", fontSize: 12.5 }}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={saveContent} disabled={busy}>
          {busy ? "Working…" : "Save edit"}
        </button>
        <button className="btn" onClick={loadVersions}>
          Version history ({draft.currentVersion})
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={labelStyle}>{content ? "Instructions to update the draft" : "Instructions for the first draft"}</label>
        <textarea
          style={{ width: "100%", minHeight: 60, padding: 8, borderRadius: 8, border: "1px solid var(--rule)", fontSize: 13 }}
          placeholder={content ? "e.g. Add a paragraph about the missed delivery deadline" : "e.g. Draft based on the case facts, demanding a refund within 15 days"}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={generate} disabled={busy}>
          {busy ? "Drafting…" : content ? "Update with AI →" : "Generate first draft with AI →"}
        </button>
      </div>

      {versions && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ marginBottom: 6 }}>Earlier versions</h4>
          {versions.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>No earlier versions yet.</p>}
          {versions.map((v) => (
            <details key={v.id} style={{ fontSize: 12, marginBottom: 6 }}>
              <summary>
                v{v.versionNumber} — {new Date(v.createdAt).toLocaleString("en-IN")}
                {v.editSummary ? ` — ${v.editSummary}` : ""}
              </summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, background: "var(--ivory-2)", padding: 8, borderRadius: 6 }}>{v.content}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftsSection({ caseId, drafts, onChanged }) {
  const [newForm, setNewForm] = useState({ draftType: "legal_notice", title: "" });
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function createDraft(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await safeFetchJson(`/api/legal/cases/${caseId}/drafts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newForm),
      });
      if (data.error) throw new Error(data.error);
      setNewForm({ draftType: "legal_notice", title: "" });
      setOpenId(data.draft.id);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDraft(id) {
    await safeFetchJson(`/api/legal/drafts/${id}`, { method: "DELETE" }).catch(() => {});
    if (openId === id) setOpenId(null);
    onChanged();
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Drafts</h2>
      {error && <div className="error-box">{error}</div>}
      {drafts.length === 0 && <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>No drafts yet.</p>}
      {drafts.map((d) => (
        <div className="source-row" key={d.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span onClick={() => setOpenId(openId === d.id ? null : d.id)} style={{ cursor: "pointer" }}>
              <b>{d.title}</b> <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>({d.draftType.replace(/_/g, " ")}, {d.status}, v{d.currentVersion})</span>
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setOpenId(openId === d.id ? null : d.id)}>
                {openId === d.id ? "Close" : "Open"}
              </button>
              <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => removeDraft(d.id)}>
                Delete
              </button>
            </div>
          </div>
          {openId === d.id && <DraftEditor draft={d} onChanged={onChanged} />}
        </div>
      ))}

      <form onSubmit={createDraft} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <select style={inputStyle} value={newForm.draftType} onChange={(e) => setNewForm({ ...newForm, draftType: e.target.value })}>
          {LEGAL_DRAFT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input style={inputStyle} placeholder="Title (optional)" value={newForm.title} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} />
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ gridColumn: "1 / -1" }}>
          {busy ? "Creating…" : "New draft"}
        </button>
      </form>
    </div>
  );
}

// -------------------------------------------------------------------- Page

export default function CaseDetailPage({ params }) {
  const { id } = usePromise(params);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    safeFetchJson(`/api/legal/cases/${id}`)
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <a href="/legal" style={{ fontSize: 13 }}>
          ← All cases
        </a>
      </div>
      <h1>{data.case.title}</h1>

      <CollapsibleSection title="Overview" defaultOpen>
        <OverviewSection caseData={data.case} onUpdated={(c) => setData((d) => ({ ...d, case: c }))} />
      </CollapsibleSection>
      <CollapsibleSection title="Parties" meta={`${data.parties.length}`}>
        <PartiesSection caseId={id} parties={data.parties} onChanged={load} />
      </CollapsibleSection>
      <CollapsibleSection title="Forum" meta={data.forum?.name || "not set"}>
        <ForumSection caseId={id} forum={data.forum} onChanged={load} />
      </CollapsibleSection>
      <CollapsibleSection title="Dates" meta={`${data.events.length}`}>
        <DatesSection caseId={id} events={data.events} onChanged={load} />
      </CollapsibleSection>
      <CollapsibleSection title="Documents" meta={`${data.documents.length}`}>
        <DocumentsSection caseId={id} documents={data.documents} onChanged={load} />
      </CollapsibleSection>
      <CollapsibleSection title="Drafts" meta={`${data.drafts.length}`}>
        <DraftsSection caseId={id} drafts={data.drafts} onChanged={load} />
      </CollapsibleSection>
    </>
  );
}
