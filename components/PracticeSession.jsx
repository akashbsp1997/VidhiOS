"use client";

import { useEffect, useState, useCallback } from "react";
import ModelAnswerPanel from "./ModelAnswerPanel.jsx";
import { offlineFetch } from "../lib/offline/offlineFetch.js";

// Every question here is generated (content-first, see the 2026-07-24
// change) -- questionSource is always "model" now, "generate" was a
// transient client-side-only value that never actually reached this map.
const SOURCE_LABEL = { model: "Model question" };

export default function PracticeSession({ forcedSubtopicId, subtopicLabel }) {
  const [question, setQuestion] = useState(null);
  const [answerText, setAnswerText] = useState("");
  // Grading is no longer synchronous (see the 2026-07-24 overnight-batch-
  // grading change) -- `submitted` just tracks "this answer is saved,"
  // there's no feedback/mastery to hold onto from the POST response anymore.
  const [submitted, setSubmitted] = useState(false);
  // Saved to IndexedDB instead of reaching the server yet -- see
  // lib/offline/offlineFetch.js. Only ever true when
  // NEXT_PUBLIC_OFFLINE_MODE_ENABLED is on; false path is unaffected.
  const [queued, setQueued] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  // Separate states, deliberately -- a "picking a question" failure (no
  // question loaded yet) and a "grading this answer" failure (question and
  // the student's already-typed answer both still exist) are different
  // situations. A single shared error used to collapse both into the same
  // full-panel error view whose only action ("Try again") fetched a
  // DIFFERENT question via loadNext -- so a transient grading hiccup (e.g.
  // the model provider returning a temporary 503 "high demand") silently
  // discarded the answer just written, with no way to just retry grading it.
  const [loadError, setLoadError] = useState(null);
  const [gradingError, setGradingError] = useState(null);

  const loadNext = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setGradingError(null);
    setSubmitted(false);
    setQueued(false);
    setAnswerText("");
    const qs = forcedSubtopicId ? `?subtopicId=${encodeURIComponent(forcedSubtopicId)}` : "";
    fetch(`/api/attempt${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error === "locked") {
          setLoadError(
            `This subtopic is locked — reach ${data.requiredMasteryPct}% mastery on ${data.requiredSubtopicText} first (currently ${data.currentMasteryPct}%).`
          );
        } else if (data.error) setLoadError(data.error);
        else setQuestion(data);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [forcedSubtopicId]);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  function submitAnswer() {
    if (!question || !answerText.trim()) return;
    setGrading(true);
    setGradingError(null);
    offlineFetch("/api/attempt", {
      subtopicId: question.subtopicId,
      questionSource: question.questionSource,
      questionRefId: question.questionRefId,
      questionTextSnapshot: question.questionText,
      difficultyTier: question.tier,
      marks: question.marks,
      answerText,
    })
      .then((data) => {
        if (data.error) setGradingError(data.error);
        else {
          setSubmitted(true);
          setQueued(!!data.queued);
        }
      })
      .catch((e) => setGradingError(e.message))
      .finally(() => setGrading(false));
  }

  if (loading) return <div className="loading">Picking your next question…</div>;
  if (loadError)
    return (
      <div className="error-box">
        {loadError}
        <div style={{ marginTop: 8 }}>
          <button className="btn" onClick={loadNext}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!question) return null;

  return (
    <>
      <h1>{subtopicLabel ? subtopicLabel : "Adaptive practice"}</h1>
      <p className="lede">
        One question at a time — your answer shapes the next one. Feedback is a practice aid from an AI grader,
        not an authoritative UPSC score.
      </p>

      <div className="card">
        <div className="meta-line">
          {question.subtopicId} · {question.subtopicText} · tier {question.tier} · {question.marks} marks ·{" "}
          {SOURCE_LABEL[question.questionSource] || question.questionSource}
        </div>

        {question.groundedInPyq && (
          <div style={{ marginBottom: 8, fontSize: 12.5, color: "var(--ink-soft)" }}>
            ✨ In the style of a real {question.groundedInPyq.year} PYQ ({question.groundedInPyq.marks} marks)
          </div>
        )}

        <div className="question-text">{question.questionText}</div>
        <ModelAnswerPanel subtopicId={question.subtopicId} questionSource={question.questionSource} questionRefId={question.questionRefId} />

        {!submitted && (
          <>
            <textarea
              className="answer-box"
              placeholder="Write your answer here…"
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              disabled={grading}
            />
            {gradingError && (
              <div className="error-box" style={{ marginTop: 10 }}>
                {gradingError}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={submitAnswer} disabled={grading || !answerText.trim()}>
                {grading ? "Saving…" : gradingError ? "Retry saving" : "Submit answer"}
              </button>
            </div>
          </>
        )}

        {submitted && (
          <div style={{ marginTop: 10 }}>
            <p className="lede" style={{ marginBottom: 0 }}>
              {queued
                ? "✓ Saved on this device — you're offline, so it'll sync automatically next time you have a connection, then get graded that night."
                : "✓ Saved — you'll get your score and feedback after tonight's grading run. Your mastery and difficulty tier for this subtopic will update then too."}
            </p>
            <button className="btn btn-primary" onClick={loadNext} style={{ marginTop: 12 }}>
              Next question →
            </button>
          </div>
        )}

        <div className="disclaimer">
          Answers are graded once a day (overnight) so feedback is available the next morning, not instantly — see
          your day's results at /results once grading has run.
        </div>
      </div>
    </>
  );
}
