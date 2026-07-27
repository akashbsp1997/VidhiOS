"use client";

import { useState } from "react";
import { LEGAL_CASE_TYPES } from "../../../../lib/legal/docTypes.js";

const inputStyle = { width: "100%", padding: "10px 12px", marginBottom: 12, borderRadius: 8, border: "1px solid var(--rule)" };
const labelStyle = { display: "block", fontSize: 13, marginBottom: 4, color: "var(--ink-soft)" };

export default function NewCasePage() {
  const [form, setForm] = useState({
    title: "",
    caseType: "civil",
    caseNumber: "",
    courtName: "",
    jurisdictionState: "",
    causeOfAction: "",
    subjectMatter: "",
    claimAmount: "",
    filingDate: "",
    description: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/legal/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, claimAmount: form.claimAmount ? Number(form.claimAmount) : null }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      window.location.href = `/legal/cases/${data.case.id}`;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>New case</h1>
      <p className="lede">Start with what you know — everything here can be edited later, and parties/forum/dates/drafts are added from the case page.</p>

      {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <label style={labelStyle}>Case title *</label>
        <input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Sharma vs. ABC Builders — flat possession dispute" required />

        <label style={labelStyle}>Case type</label>
        <select style={inputStyle} value={form.caseType} onChange={(e) => set("caseType", e.target.value)}>
          {LEGAL_CASE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <label style={labelStyle}>Case/complaint number (if already filed)</label>
        <input style={inputStyle} value={form.caseNumber} onChange={(e) => set("caseNumber", e.target.value)} />

        <label style={labelStyle}>Court / forum (specific bench, if known)</label>
        <input style={inputStyle} value={form.courtName} onChange={(e) => set("courtName", e.target.value)} placeholder="You can also pick a forum type from the catalog on the case page" />

        <label style={labelStyle}>Jurisdiction (state)</label>
        <input style={inputStyle} value={form.jurisdictionState} onChange={(e) => set("jurisdictionState", e.target.value)} />

        <label style={labelStyle}>Subject matter (short tag, helps forum suggestions)</label>
        <input style={inputStyle} value={form.subjectMatter} onChange={(e) => set("subjectMatter", e.target.value)} placeholder="e.g. consumer dispute, cheque bounce, service matter" />

        <label style={labelStyle}>Cause of action</label>
        <input style={inputStyle} value={form.causeOfAction} onChange={(e) => set("causeOfAction", e.target.value)} placeholder="The underlying wrong/dispute, in your own words" />

        <label style={labelStyle}>Claim amount (₹, if applicable)</label>
        <input style={inputStyle} type="number" value={form.claimAmount} onChange={(e) => set("claimAmount", e.target.value)} />

        <label style={labelStyle}>Filing date (if already filed)</label>
        <input style={inputStyle} type="date" value={form.filingDate} onChange={(e) => set("filingDate", e.target.value)} />

        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.description} onChange={(e) => set("description", e.target.value)} />

        <button className="btn btn-primary" type="submit" disabled={busy || !form.title.trim()} style={{ width: "100%" }}>
          {busy ? "Creating…" : "Create case"}
        </button>
      </form>
    </div>
  );
}
