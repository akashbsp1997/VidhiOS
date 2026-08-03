"use client";

import { useEffect, useState } from "react";
import { GROWTH_STAGES, HEALTH_STATES } from "../../lib/forest/growth.js";
import PlantGlyph from "./PlantGlyph.jsx";
import { createClient } from "../../lib/supabase/client.js";

function lastAttemptedLabel(daysSince) {
  if (daysSince == null) return "not attempted yet";
  if (daysSince < 1) return "attempted today";
  const d = Math.round(daysSince);
  return `attempted ${d} day${d === 1 ? "" : "s"} ago`;
}

const STATUS_LABEL = { pending: "Processing…", extracted: "Ready", needs_ocr: "Scanned — can't read yet", error: "Failed" };

// A student's own procured material (Laxmikanth, Spectrum, PMF/Vision IAS,
// etc.) for THIS subtopic -- private to them, never mixed into any other
// user's grounding (see db/schema.js's personalSources). Uses the same
// signed-upload-URL flow app/ingest/upload/page.jsx already established,
// just against /api/my-sources instead of the admin /api/ingest routes.
function PersonalSources({ subtopicId }) {
  const [sources, setSources] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stepMsg, setStepMsg] = useState(null);

  function load() {
    fetch(`/api/my-sources?subtopicId=${encodeURIComponent(subtopicId)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setSources(d.sources)))
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    setSources(null);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtopicId]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be picked again later
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setStepMsg("Requesting upload URL…");
      const urlRes = await fetch("/api/my-sources/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subtopicId, filename: file.name }),
      });
      const urlData = await urlRes.json();
      if (urlData.error) throw new Error(urlData.error);

      setStepMsg("Uploading…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage.from("personal-sources").uploadToSignedUrl(urlData.storagePath, urlData.token, file);
      if (uploadError) throw new Error(uploadError.message);

      setStepMsg("Extracting text…");
      const finalizeRes = await fetch("/api/my-sources/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subtopicId, storagePath: urlData.storagePath, title: file.name, fileSizeBytes: file.size }),
      });
      const finalizeData = await finalizeRes.json();
      if (finalizeData.error) throw new Error(finalizeData.error);

      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setStepMsg(null);
    }
  }

  function handleDelete(id) {
    fetch(`/api/my-sources?id=${id}`, { method: "DELETE" })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : load()));
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
      <div className="forest-ladder-label">Your own material</div>
      {error && <p style={{ fontSize: 12.5, color: "var(--accent-red)" }}>{error}</p>}
      {sources?.length > 0 && (
        <ul style={{ margin: "0 0 8px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {sources.map((s) => (
            <li key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
              <span>
                {s.title} <span style={{ color: "var(--ink-soft)", fontSize: 11.5 }}>— {STATUS_LABEL[s.status] ?? s.status}</span>
              </span>
              <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => handleDelete(s.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="btn" style={{ fontSize: 12.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
        {busy ? stepMsg || "Working…" : "＋ Upload a PDF you own"}
        <input type="file" accept="application/pdf" onChange={handleUpload} disabled={busy} style={{ display: "none" }} />
      </label>
      <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}>
        Private to you — grounds your own Teach content alongside NCERT and PYQs, never shown to other students.
      </p>
    </div>
  );
}

// The tap target from ForestCanopy's plant grid -- growth ladder, health
// strip, a short "why" line (design doc §5's plant detail sheet), the same
// "Revise now" hand-off the List view's row link already uses (/learn/{id}),
// and a place to add the student's own procured study material.
export default function PlantDetailSheet({ subtopic, onClose }) {
  if (!subtopic) return null;
  const stageIdx = GROWTH_STAGES.findIndex((s) => s.id === subtopic.growthStage);
  const healthIdx = HEALTH_STATES.findIndex((s) => s.id === subtopic.health);

  return (
    <div className="forest-sheet-backdrop" onClick={onClose}>
      <div className="forest-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={subtopic.topicText}>
        <button className="forest-sheet-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 4 }}>
          <PlantGlyph growthStage={subtopic.growthStage} health={subtopic.health} size={56} />
          <div>
            <div className="subtopic-code">{subtopic.id}</div>
            <h3 style={{ margin: "2px 0 0", fontSize: 17 }}>{subtopic.topicText}</h3>
          </div>
        </div>

        <div className="forest-ladder-label">Growth</div>
        <div className="forest-ladder">
          {GROWTH_STAGES.map((s, i) => (
            <span key={s.id} className={`stage-chip${i === stageIdx ? " on" : ""}`}>
              {s.label}
            </span>
          ))}
        </div>

        <div className="forest-ladder-label">Health</div>
        <div className="forest-ladder">
          {HEALTH_STATES.map((s, i) => (
            <span key={s.id} className={`stage-chip health${i === healthIdx ? " on" : ""}`}>
              {s.label}
            </span>
          ))}
        </div>

        <p className="lede" style={{ margin: "14px 0" }}>
          {lastAttemptedLabel(subtopic.daysSinceCheckpoint)}
          {subtopic.retentionPct != null && subtopic.daysSinceCheckpoint != null && ` · estimated retention ${subtopic.retentionPct}%`}
          {" · "}
          {Math.round(subtopic.masteryScore * 100)}% mastery
        </p>

        {subtopic.locked ? (
          <span className="locked-pill">
            Locked — reach {subtopic.requiredMasteryPct}% mastery on {subtopic.requiredSubtopicText} first
          </span>
        ) : (
          <>
            <a className="btn btn-primary" href={`/learn/${subtopic.id}`}>
              Revise now →
            </a>
            <PersonalSources subtopicId={subtopic.id} />
          </>
        )}
      </div>
    </div>
  );
}
