"use client";

import { useEffect, useState } from "react";

const TRACK_LABEL = {
  starting_out: "Starting Out",
  beginner: "Beginner",
  advanced: "Advanced",
  fastforward: "Fast Forward",
};
const TRACK_BLURB = {
  starting_out: "Your first week is light and foundational -- one topic a day, no prior knowledge assumed.",
  beginner: "Your first week covers the basics at a steady pace, a bit more ground per day.",
  advanced: "Your first week moves quickly through core topics -- you've got a head start.",
  fastforward: "Your first week is packed and PYQ-heavy -- built for someone ready to hit the ground running.",
};

// One-time setup: 2 GS papers + 1 optional subject, unlocked together (see
// lib/adaptive/subjectUnlockState.js's initializeSubjectUnlocks). More GS
// papers unlock automatically later (mastery or a calendar checkpoint,
// whichever comes first) -- the optional choice stays fixed after this,
// matching how a real UPSC candidate only ever sits one optional paper.
export default function OnboardingPage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [gsSelection, setGsSelection] = useState([]);
  // Defaults to PSIR -- this app's most fully-built-out optional (the fixed
  // first onboarding week is PSIR-based regardless of this pick, see
  // db/seed/onboardingWeekPlans.js), not a hard requirement. Still fully
  // changeable via the picker below.
  const [optionalSubjectId, setOptionalSubjectId] = useState("political-science-optional");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Mandatory placement quiz (db/seed/placementQuiz.js) comes first -- it
  // decides which of the 4 fixed 7-day tracks (starting_out/beginner/
  // advanced/fastforward) a new student sees, and doesn't depend on which
  // subjects they pick. 'quiz' -> 'subjects', one submit at the end.
  const [step, setStep] = useState("quiz");
  const [quizAnswers, setQuizAnswers] = useState({});
  const [assignedTrack, setAssignedTrack] = useState(null);

  useEffect(() => {
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setState(data);
        setGsSelection(data.onboardingComplete ? data.unlockedGsIds : data.recommendedGsSubjectIds);
        if (data.onboardingComplete) setOptionalSubjectId(data.optionalSubjectId ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);

  function toggleGs(id) {
    setGsSelection((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id]; // keep it a rolling pair rather than blocking the click
      return [...prev, id];
    });
  }

  function answerQuiz(questionId, optionIndex) {
    setQuizAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
  }

  const quizComplete = state?.placementQuiz?.every((q) => Number.isInteger(quizAnswers[q.id])) ?? false;

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gsSubjectIds: gsSelection, optionalSubjectId, quizAnswers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "Could not save your plan.");
        return;
      }
      setAssignedTrack(data.track);
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <>
        <h1>Set up your plan</h1>
        <div className="error-box">{error}</div>
      </>
    );
  }

  if (!state) return <div className="loading">Loading…</div>;

  if (state.onboardingComplete) {
    return (
      <>
        <p style={{ fontSize: 12.5, marginBottom: 12 }}>
          <a href="/">← Dashboard</a>
        </p>
        <h1>Your plan is already set up</h1>
        <p className="lede">
          GS unlocked so far: {state.unlockedGsIds.join(", ").toUpperCase() || "none yet"}. Optional subject:{" "}
          {state.optionalSubjects.find((s) => s.subjectId === state.optionalSubjectId)?.displayName ?? state.optionalSubjectId}.
          More GS papers unlock automatically as you make progress.
        </p>
      </>
    );
  }

  const canSubmit = gsSelection.length === 2 && !!optionalSubjectId;

  if (assignedTrack) {
    return (
      <>
        <h1>You're placed! 🎯</h1>
        <div className="card">
          <p className="lede" style={{ marginBottom: 4 }}>
            Track: <b>{TRACK_LABEL[assignedTrack] ?? assignedTrack}</b>
          </p>
          <p style={{ fontSize: 13.5, marginBottom: 0 }}>{TRACK_BLURB[assignedTrack]}</p>
        </div>
        <p className="lede">
          Your first 7 days are preloaded — a fixed, day-by-day PSIR + GS start built for your level, with a
          write-your-own-answer step each day. After day 7, your plan adapts to how those answers and a short test
          actually went.
        </p>
        <button className="btn btn-primary" onClick={() => (window.location.href = "/")}>
          Start Day 1 →
        </button>
      </>
    );
  }

  if (step === "quiz") {
    return (
      <>
        <p style={{ fontSize: 12.5, marginBottom: 12 }}>
          <a href="/">← Dashboard</a>
        </p>
        <h1>Quick placement check</h1>
        <p className="lede">
          7 quick questions, no wrong answers to worry about — this just decides which of 4 preloaded first-week
          tracks fits you best (Starting Out, Beginner, Advanced, Fast Forward). Takes under a minute.
        </p>

        {(state.placementQuiz ?? []).map((q) => (
          <div className="card" key={q.id}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>{q.text}</p>
            <div className="segmented" style={{ flexWrap: "wrap" }}>
              {q.options.map((o, i) => (
                <button key={i} className={`seg${quizAnswers[q.id] === i ? " active" : ""}`} onClick={() => answerQuiz(q.id, i)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button className="btn btn-primary" disabled={!quizComplete} onClick={() => setStep("subjects")}>
          Continue →
        </button>
      </>
    );
  }

  return (
    <>
      <p style={{ fontSize: 12.5, marginBottom: 12 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); setStep("quiz"); }}>
          ← Back to placement check
        </a>
      </p>
      <h1>Set up your 1-year plan</h1>
      <p className="lede">
        Pick 2 GS papers to start with — GS I and GS II are recommended, but you can pick any two. More GS papers
        unlock automatically as you make progress (mastery or time, whichever comes first). Then pick your one
        optional subject — this is fixed once you start, matching how the real exam works.
      </p>

      <div className="card">
        <h2>GS papers (pick 2)</h2>
        <div className="segmented">
          {state.gsSubjects.map((s) => (
            <button key={s.id} className={`seg${gsSelection.includes(s.id) ? " active" : ""}`} onClick={() => toggleGs(s.id)}>
              {s.displayName}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Optional subject</h2>
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: -4, marginBottom: 8 }}>
          We default you to Political Science &amp; IR (PSIR) — this app supports it most deeply today. Change it
          below if you already know your optional.
        </p>
        <select
          value={optionalSubjectId}
          onChange={(e) => setOptionalSubjectId(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--rule)", background: "var(--ivory-2)" }}
        >
          <option value="">Choose your optional subject…</option>
          {state.optionalSubjects.map((s) => (
            <option key={s.subjectId} value={s.subjectId}>
              {s.displayName}
            </option>
          ))}
        </select>
        {optionalSubjectId && optionalSubjectId !== "political-science-optional" && (
          <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8, marginBottom: 0 }}>
            Note: your first 7 preloaded days still preview PSIR content for the optional-subject slots, since it's
            what's fully built out today — your plan adapts to {state.optionalSubjects.find((s) => s.subjectId === optionalSubjectId)?.displayName ?? "your optional"} from
            there.
          </p>
        )}
      </div>

      {submitError && <div className="error-box">{submitError}</div>}

      <button className="btn btn-primary" disabled={!canSubmit || submitting} onClick={submit}>
        {submitting ? "Saving…" : "Start my plan →"}
      </button>
    </>
  );
}
