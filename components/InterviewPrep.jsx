"use client";

import { useEffect, useState, useRef } from "react";
import LockdownNotice from "./LockdownNotice.jsx";
import { offlineFetch } from "../lib/offline/offlineFetch.js";

const CATEGORY_LABEL = { background: "Background", optional: "Optional subject", "current-affairs": "Current affairs", situational: "Situational" };
const PROFILE_FIELDS = [
  { key: "hometown", label: "Hometown / state" },
  { key: "education", label: "Education" },
  { key: "workExperience", label: "Work experience" },
  { key: "hobbies", label: "Hobbies / interests" },
  { key: "servicePreference", label: "Service preference" },
];

// A mock UPSC Personality Test (interview) session -- generates a realistic
// DAF-based question set grounded in the candidate's own stated background,
// then lets them log their own post-hoc reflection per question. Doesn't
// attempt to AI-grade a typed answer (see app/api/interview-sessions --
// a real interview is judged on demeanor and delivery, not just content).
export default function InterviewPrep({ viewSessionId }) {
  const [profile, setProfile] = useState(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [history, setHistory] = useState(null);
  const [session, setSession] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [genLockdown, setGenLockdown] = useState(null);
  const noteTimers = useRef({});

  useEffect(() => {
    if (viewSessionId) {
      fetch(`/api/interview-sessions?id=${viewSessionId}`)
        .then((r) => r.json())
        .then((d) => (d.error ? setError(d.error) : setSession(d)));
      return;
    }
    fetch("/api/interview-profile")
      .then((r) => r.json())
      .then((d) => !d.error && setProfile(d));
    fetch("/api/interview-sessions")
      .then((r) => r.json())
      .then((d) => !d.error && setHistory(d.sessions));
  }, [viewSessionId]);

  function saveProfile() {
    fetch("/api/interview-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    }).then(() => {
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 1400);
    });
  }

  function generateSession() {
    setGenerating(true);
    setError(null);
    setGenLockdown(null);
    fetch("/api/interview-sessions", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error === "locked_down") setGenLockdown(d);
        else if (d.error) setError(d.error);
        else setSession({ ...d, notes: {} });
      })
      .catch((e) => setError(e.message))
      .finally(() => setGenerating(false));
  }

  function onNoteChange(index, value) {
    setSession((s) => ({ ...s, notes: { ...s.notes, [index]: value } }));
    clearTimeout(noteTimers.current[index]);
    noteTimers.current[index] = setTimeout(() => {
      offlineFetch("/api/interview-sessions/notes", { sessionId: session.id, questionIndex: index, note: value }).catch(() => {});
    }, 700);
  }

  if (error) return <div className="error-box">{error}</div>;

  if (session) {
    return (
      <>
        {!viewSessionId && (
          <p style={{ fontSize: 12.5, marginBottom: 12 }}>
            <a href="/interview" onClick={() => setSession(null)}>
              ← Back
            </a>
          </p>
        )}
        {session.questions.map((q, i) => (
          <div className="card" key={i}>
            <div className="meta-line">{CATEGORY_LABEL[q.category] ?? q.category}</div>
            <div className="question-text">{q.question}</div>
            <textarea
              className="answer-box"
              placeholder="Your own reflection on how you'd answer / how it went — not graded, just for you…"
              value={session.notes?.[i] ?? ""}
              onChange={(e) => onNoteChange(i, e.target.value)}
              style={{ minHeight: 70, marginTop: 10 }}
            />
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your background</h2>
        <p className="lede" style={{ marginBottom: 10 }}>
          Fed into your mock questions — self-declared, not verified against anything.
        </p>
        {!profile ? (
          <div className="loading">Loading…</div>
        ) : (
          <>
            {PROFILE_FIELDS.map((f) => (
              <div key={f.key} style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 12.5, color: "var(--ink-soft)", display: "block", marginBottom: 3 }}>{f.label}</label>
                <input
                  type="text"
                  value={profile[f.key] ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, [f.key]: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--rule)" }}
                />
              </div>
            ))}
            <button className="btn" onClick={saveProfile}>
              Save
            </button>
            <span style={{ marginLeft: 10, fontSize: 12, color: "var(--forest)", opacity: profileSaved ? 1 : 0, transition: "opacity 0.3s" }}>Saved</span>
          </>
        )}
      </div>

      <div className="card">
        {genLockdown ? (
          <LockdownNotice lockdown={genLockdown} />
        ) : (
          <button className="btn btn-primary" onClick={generateSession} disabled={generating}>
            {generating ? "Building your question set…" : "Generate a mock interview →"}
          </button>
        )}
      </div>

      {history && history.length > 0 && (
        <div className="card">
          <h2>Past sessions</h2>
          {history.map((s) => (
            <div className="subtopic-row" key={s.id} style={{ gridTemplateColumns: "1fr auto" }}>
              <span className="subtopic-text">
                <a href={`/interview?view=${s.id}`}>{s.questionCount} questions</a>
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{new Date(s.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
