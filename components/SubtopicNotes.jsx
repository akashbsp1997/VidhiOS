"use client";

import { useEffect, useRef, useState } from "react";
import { offlineFetch } from "../lib/offline/offlineFetch.js";

const STATUS_OPTIONS = [
  { key: "not-started", label: "Not started" },
  { key: "in-progress", label: "In progress" },
  { key: "done", label: "Done" },
];

// Personal tracking layer, ported from a UPSC-prep design reviewed alongside
// this app (its per-topic notes + status tracker) -- deliberately kept
// separate from the real AI-graded mastery/stage shown elsewhere on this
// page. See db/schema.js's mastery.notes/selfStatus comment for why: a
// student's own "I consider this covered" and the AI's "you've demonstrated
// mastery of this" are honestly different signals, so this never feeds the
// adaptive engine or the mastery-gating logic, and nothing in this app
// auto-updates it on the student's behalf.
export default function SubtopicNotes({ subtopicId }) {
  const [notes, setNotes] = useState("");
  const [selfStatus, setSelfStatus] = useState("not-started");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    setLoaded(false);
    fetch(`/api/subtopic-notes?subtopicId=${encodeURIComponent(subtopicId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setNotes(data.notes || "");
          setSelfStatus(data.selfStatus || "not-started");
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => clearTimeout(saveTimer.current);
  }, [subtopicId]);

  function persist(partial) {
    offlineFetch("/api/subtopic-notes", { subtopicId, ...partial })
      .then((data) => {
        if (!data.error) {
          setSaved(true);
          setTimeout(() => setSaved(false), 1400);
        }
      })
      .catch(() => {});
  }

  function onNotesChange(value) {
    setNotes(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist({ notes: value }), 700);
  }

  function onStatusChange(status) {
    setSelfStatus(status);
    persist({ selfStatus: status });
  }

  if (!loaded) return null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Your notes</h2>
        <span style={{ fontSize: 11.5, color: "var(--forest)", opacity: saved ? 1 : 0, transition: "opacity 0.3s" }}>Saved</span>
      </div>

      <div className="segmented" style={{ marginBottom: 10 }}>
        {STATUS_OPTIONS.map((s) => (
          <button key={s.key} className={`seg${selfStatus === s.key ? " active" : ""}`} onClick={() => onStatusChange(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      <textarea
        className="answer-box"
        placeholder="Personal notes for this topic — separate from AI-graded mastery, just for you…"
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        style={{ minHeight: 100 }}
      />
    </div>
  );
}
