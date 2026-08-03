"use client";

import { useEffect, useState } from "react";

// The RPG hook shown once per (student, subtopic), before any teaching --
// see app/api/dragon-challenge/route.js. Submitting (not being graded) is
// what completes it: grading happens in tonight's batch run, same
// convention as every other free-text answer in this app, so `onDone` fires
// right after a successful POST rather than waiting on a score.
export default function DragonChallenge({ subtopicId, onDone }) {
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState(null);
  const [answerText, setAnswerText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/dragon-challenge?subtopicId=${encodeURIComponent(subtopicId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        // Already submitted in an earlier visit -- nothing to show, move
        // straight on rather than re-litigating a question already answered.
        if (d.submittedAt) return onDone();
        setChallenge(d);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtopicId]);

  function submit() {
    if (!answerText.trim()) return;
    setSubmitting(true);
    setError(null);
    fetch("/api/dragon-challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subtopicId, answerText }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        onDone();
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (error) {
    return (
      <div className="error-box">
        {error}
        <div style={{ marginTop: 8 }}>
          <button className="btn" onClick={onDone}>
            Skip ahead →
          </button>
        </div>
      </div>
    );
  }

  if (!challenge) return <div className="loading">A wise old dragon stirs…</div>;

  return (
    <div className="card" style={{ borderColor: "var(--primary)" }}>
      <h1 style={{ marginTop: 0 }}>🐉 The Dragon's Challenge</h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.6 }}>
        An old dragon blocks your path, guarding this subtopic. "Before I teach you anything," it rumbles, "let's see
        what you already know." It poses a real exam question and waits.
      </p>
      <div className="card" style={{ background: "var(--surface-2)", marginTop: 10 }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>{challenge.questionText}</p>
        <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: 0 }}>{challenge.marks} marks</p>
      </div>

      <textarea
        rows={8}
        style={{ width: "100%", marginTop: 12 }}
        placeholder="Write your answer -- attempt it cold, this is just to see where you stand."
        value={answerText}
        onChange={(e) => setAnswerText(e.target.value)}
      />
      <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={submit} disabled={submitting || !answerText.trim()}>
        {submitting ? "Handing it to the dragon…" : "Attempt the question →"}
      </button>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>
        The dragon reads slowly -- its verdict (score + feedback) will be ready after tonight. You don't have to wait
        for it: submitting sends you straight on to learn this subtopic.
      </p>
    </div>
  );
}
