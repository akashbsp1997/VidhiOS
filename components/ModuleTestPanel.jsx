"use client";

import { useEffect, useState } from "react";
import ModelAnswerPanel from "./ModelAnswerPanel.jsx";

// Every module Test is generated now (content-first, see the 2026-07-24
// change) -- questionSource is always "model".
const SOURCE_LABEL = { model: "Model question" };

// "Monster Battle" -- a purely cosmetic reskin of this module's real Test
// (explicit request: "tested by a small adventure of defeating a sphinx or
// a lion or a centaur"). Deliberately NOT a new question format or a new
// grading path -- this app's answer grading moved to one predictable
// nightly batch window on 2026-07-24 specifically to keep AI usage
// predictable, and reworking that same night to also support instant
// win/lose combat feedback would fight that decision. So "defeating" the
// creature is the act of submitting a real attempt (same thing that
// already unlocks the next module) -- the AI's actual verdict still
// arrives the next morning, same as every other test in this app.
const CREATURES = [
  { name: "Sphinx", emoji: "🗿", verb: "answer its riddle" },
  { name: "Lion", emoji: "🦁", verb: "stand your ground" },
  { name: "Centaur", emoji: "🐎", verb: "match its challenge" },
  { name: "Gorgon", emoji: "🐍", verb: "hold your nerve" },
  { name: "Griffin", emoji: "🦅", verb: "prove your worth" },
  { name: "Minotaur", emoji: "🐂", verb: "navigate the maze" },
];

function creatureForModule(moduleId) {
  return CREATURES[Math.abs(Number(moduleId) || 0) % CREATURES.length];
}

// Deliberately NOT PracticeSession -- that component's loadNext/"Next
// question →" loop assumes an unbounded adaptive pool (real PYQs mixed
// with rotating model questions), which doesn't fit this panel's shape:
// exactly one cached, module-scoped question (see
// app/api/attempt/route.js's handleModuleQuestion), answer it once, then
// advance to the next module -- no pool, no retry-a-different-question
// path needed.
export default function ModuleTestPanel({ subtopicId, moduleId, moduleTitle, isLastModule, nextModuleLocked, nextModuleLockReasonLabel, onNext, onGraded }) {
  const [question, setQuestion] = useState(null);
  const [answerText, setAnswerText] = useState("");
  // Grading is no longer synchronous (see the 2026-07-24 overnight-batch-
  // grading change) -- `submitted` just tracks "this answer is saved," not
  // "graded." Progression to the next module no longer waits on a score.
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  // Two separate error states, deliberately -- a GET failure (no question
  // ever loaded) and a POST/grading failure (question and the student's
  // already-typed answer both still exist, grading just didn't complete)
  // are different situations. A single shared error used to collapse both
  // into the same full-panel "nothing worked, skip this test" view, which
  // meant a transient grading hiccup (e.g. the model provider returning a
  // temporary 503 "high demand") silently discarded whatever the student had
  // just written, with no way to just retry grading it.
  const [loadError, setLoadError] = useState(null);
  const [gradingError, setGradingError] = useState(null);

  useEffect(() => {
    setQuestion(null);
    setAnswerText("");
    setSubmitted(false);
    setLoadError(null);
    setGradingError(null);
    setLoading(true);
    fetch(`/api/attempt?subtopicId=${encodeURIComponent(subtopicId)}&moduleId=${moduleId}`)
      .then((r) => r.json())
      .then((data) => (data.error ? setLoadError(data.error) : setQuestion(data)))
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [subtopicId, moduleId]);

  function submitAnswer() {
    if (!question || !answerText.trim()) return;
    setGrading(true);
    setGradingError(null);
    fetch("/api/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subtopicId,
        moduleId,
        questionSource: question.questionSource,
        questionRefId: question.questionRefId,
        questionTextSnapshot: question.questionText,
        difficultyTier: question.tier,
        marks: question.marks,
        answerText,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setGradingError(data.error);
          return;
        }
        setSubmitted(true);
        // This attempt just bumped moduleProgress[moduleId].testAttempts in
        // the DB (immediately, no AI -- see app/api/attempt/route.js's
        // POST), which is HALF of what decides whether the NEXT module is
        // locked (see lib/adaptive/unlocks.js's computeModuleLocks) -- the
        // other half, the subtopic mastery floor, only updates after
        // tonight's grading run. Re-syncing now still matters: it clears
        // the "previous_test_not_attempted" reason right away even though
        // "mastery_below_threshold" may still hold until grading runs.
        onGraded?.();
      })
      .catch((e) => setGradingError(e.message))
      .finally(() => setGrading(false));
  }

  // Every module Test is generated now (content-first, see the 2026-07-24
  // change) -- retrying always means generating a genuinely different
  // question via force=true (see app/api/attempt/route.js's
  // handleModuleQuestion), no more "fixed real text, just reset locally" case.
  function retryTest() {
    setAnswerText("");
    setSubmitted(false);
    setGradingError(null);
    setLoadError(null);
    setLoading(true);
    fetch(`/api/attempt?subtopicId=${encodeURIComponent(subtopicId)}&moduleId=${moduleId}&force=true`)
      .then((r) => r.json())
      .then((data) => (data.error ? setLoadError(data.error) : setQuestion(data)))
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }

  if (loading) return <div className="loading">Preparing this module's question…</div>;
  if (loadError)
    return (
      <div className="error-box">
        {loadError}
        <div style={{ marginTop: 8 }}>
          <button className="btn" onClick={onNext}>
            Skip this test
          </button>
        </div>
      </div>
    );
  if (!question) return null;

  const creature = creatureForModule(moduleId);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 26 }}>{creature.emoji}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>The {creature.name} bars your way</div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
            {moduleTitle} · {question.marks} marks · {creature.verb} to pass
          </div>
        </div>
      </div>
      <div className="meta-line">{SOURCE_LABEL[question.questionSource] || question.questionSource}</div>
      {question.groundedInPyq && (
        <div style={{ marginBottom: 8, fontSize: 12.5, color: "var(--ink-soft)" }}>
          ✨ In the style of a real {question.groundedInPyq.year} PYQ ({question.groundedInPyq.marks} marks)
        </div>
      )}
      <div className="question-text">{question.questionText}</div>
      <ModelAnswerPanel subtopicId={subtopicId} questionSource={question.questionSource} questionRefId={question.questionRefId} />

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
              {grading ? "Striking…" : gradingError ? "Retry the strike" : `⚔️ Strike the ${creature.name}`}
            </button>
          </div>
        </>
      )}

      {submitted && (
        <div style={{ marginTop: 10 }}>
          <p className="lede" style={{ marginBottom: 0 }}>
            {creature.emoji} The {creature.name} yields — you'll see how well you actually fought after tonight's grading run.
          </p>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" onClick={retryTest}>
              Retry this test
            </button>
            {/* Previously this button called onNext unconditionally even when
                the next module was locked -- goToModule silently no-ops on a
                locked module (see components/ModuleLearnFlow.jsx), so
                clicking it did nothing with zero feedback, reading as "the
                button doesn't work" rather than "this module is locked." */}
            {!isLastModule && nextModuleLocked ? (
              <span className="btn" style={{ opacity: 0.6, cursor: "not-allowed" }} title={nextModuleLockReasonLabel}>
                🔒 Next module locked
              </span>
            ) : (
              <button className="btn btn-primary" onClick={onNext}>
                {isLastModule ? "Finish this subtopic →" : "Next module →"}
              </button>
            )}
          </div>
          {!isLastModule && nextModuleLocked && (
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 6, marginBottom: 0 }}>
              {nextModuleLockReasonLabel}
              {nextModuleLocked.requiredMasteryPct != null &&
                ` — reach ${nextModuleLocked.requiredMasteryPct}% mastery on this subtopic first (currently ${nextModuleLocked.currentMasteryPct}%). `}
              Keep practicing this module, or try{" "}
              <a href="/practice">adaptive practice →</a>.
            </p>
          )}
        </div>
      )}

      <div className="disclaimer">
        Answers are graded once a day (overnight), so feedback is available the next morning, not instantly — AI-graded
        feedback can be wrong, especially on exact citations, so cross-check anything you plan to use in a real answer.
      </div>
    </>
  );
}
