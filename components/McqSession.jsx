"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import LockdownNotice from "./LockdownNotice.jsx";

const OPTION_LETTER = ["A", "B", "C", "D"];

// Quiz Arcade: the first of this app's per-content-area "different games"
// (see the redesign request this came from) -- Prelims MCQ is the natural
// candidate since grading is already instant/deterministic, unlike
// descriptive practice's AI-graded wait. Layered entirely client-side on
// top of the existing /api/mcq fetch/grade cycle -- no new backend needed,
// since "different game" here means a timed-round/combo-streak presentation
// of the same real questions and real accuracy tracking, not a different
// scoring model underneath.
const ROUND_LENGTH = 10;
const QUESTION_SECONDS = 20;
const COMBO_TIERS = [
  { minStreak: 5, multiplier: 2 },
  { minStreak: 3, multiplier: 1.5 },
  { minStreak: 0, multiplier: 1 },
];

function multiplierForStreak(streak) {
  return COMBO_TIERS.find((t) => streak >= t.minStreak).multiplier;
}

export default function McqSession() {
  const [question, setQuestion] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [result, setResult] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [gradingError, setGradingError] = useState(null);
  const [lockdown, setLockdown] = useState(null);

  // --- Arcade state: round progress, combo streak, round score, timer ---
  const [roundIndex, setRoundIndex] = useState(0); // 0-based, within [0, ROUND_LENGTH)
  const [roundScore, setRoundScore] = useState(0);
  const [comboStreak, setComboStreak] = useState(0);
  const [bestComboThisRound, setBestComboThisRound] = useState(0);
  const [timeLeft, setTimeLeft] = useState(QUESTION_SECONDS);
  const [roundComplete, setRoundComplete] = useState(false);
  const timerRef = useRef(null);
  const submitRef = useRef(null); // always points at the current submitAnswer, so the timer's setTimeout closes over fresh state

  const loadNext = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setGradingError(null);
    setLockdown(null);
    setResult(null);
    setSelectedIndex(null);
    setTimeLeft(QUESTION_SECONDS);
    fetch("/api/mcq")
      .then((r) => r.json())
      .then((data) => {
        if (data.error === "locked_down") setLockdown(data);
        else if (data.error) setLoadError(data.error);
        else setQuestion(data);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  // Countdown timer -- runs while a question is up and unanswered. Auto-
  // submits as a timeout (selectedIndex -1, i.e. no valid option) once it
  // hits 0, which /api/mcq correctly grades as incorrect since -1 never
  // matches a real correctIndex.
  useEffect(() => {
    if (!question || result || grading) return;
    if (timeLeft <= 0) {
      submitRef.current?.(-1);
      return;
    }
    timerRef.current = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timerRef.current);
  }, [question, result, grading, timeLeft]);

  function submitAnswer(indexOverride) {
    const index = indexOverride ?? selectedIndex;
    if (!question || index == null) return;
    clearTimeout(timerRef.current);
    setGrading(true);
    setGradingError(null);
    fetch("/api/mcq", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subtopicId: question.subtopicId, questionRefId: question.questionRefId, selectedIndex: index }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error === "locked_down") {
          setLockdown(data);
          return;
        }
        if (data.error) {
          setGradingError(data.error);
          return;
        }
        setResult(data);
        setStats(data.stats);
        if (data.correct) {
          const newStreak = comboStreak + 1;
          setComboStreak(newStreak);
          setBestComboThisRound((b) => Math.max(b, newStreak));
          setRoundScore((s) => s + Math.round(100 * multiplierForStreak(newStreak)));
        } else {
          setComboStreak(0);
        }
      })
      .catch((e) => setGradingError(e.message))
      .finally(() => setGrading(false));
  }
  submitRef.current = submitAnswer;

  function nextQuestion() {
    const nextRoundIndex = roundIndex + 1;
    if (nextRoundIndex >= ROUND_LENGTH) {
      setRoundComplete(true);
      return;
    }
    setRoundIndex(nextRoundIndex);
    loadNext();
  }

  function playAgain() {
    setRoundIndex(0);
    setRoundScore(0);
    setComboStreak(0);
    setBestComboThisRound(0);
    setRoundComplete(false);
    loadNext();
  }

  if (roundComplete) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Round complete! 🏁</h2>
        <p className="lede" style={{ marginBottom: 10 }}>
          Round score <b>{roundScore}</b> · best combo <b>x{multiplierForStreak(bestComboThisRound)}</b> ({bestComboThisRound}
          -streak)
          {stats && (
            <>
              {" "}
              · lifetime accuracy {stats.correct}/{stats.attempted} ({stats.attempted ? Math.round((stats.correct / stats.attempted) * 100) : 0}%)
            </>
          )}
        </p>
        <button className="btn btn-primary" onClick={playAgain}>
          Play another round →
        </button>
      </div>
    );
  }

  if (loading) return <div className="loading">Picking your next MCQ…</div>;

  if (lockdown) return <LockdownNotice lockdown={lockdown} />;

  if (loadError === "onboarding_not_complete") {
    return (
      <div className="card">
        <p className="lede" style={{ marginBottom: 10 }}>
          Set up your plan first — pick your 2 starting GS papers and your optional subject.
        </p>
        <a className="btn btn-primary" href="/onboarding">
          Get started →
        </a>
      </div>
    );
  }

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

  const multiplier = multiplierForStreak(comboStreak);
  const timerPct = Math.max(0, Math.min(100, (timeLeft / QUESTION_SECONDS) * 100));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          Question {roundIndex + 1} of {ROUND_LENGTH} · round score <b>{roundScore}</b>
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: comboStreak >= 3 ? "var(--brass)" : "var(--ink-soft)" }}>
          {comboStreak > 0 ? `🔥 ${comboStreak}-streak · x${multiplier}` : "No streak yet"}
        </span>
      </div>

      {!result && (
        <div className="bar" style={{ marginBottom: 10 }} title={`${timeLeft}s left`}>
          <span style={{ width: `${timerPct}%`, background: timeLeft <= 5 ? "var(--maroon)" : undefined }} />
        </div>
      )}

      {stats && (
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 }}>
          Lifetime: {stats.correct}/{stats.attempted} correct ({stats.attempted ? Math.round((stats.correct / stats.attempted) * 100) : 0}%)
        </p>
      )}

      <div className="card">
        <div className="meta-line">
          {question.subtopicId} · {question.subtopicText}
        </div>

        <div className="question-text">{question.questionText}</div>

        {!result && (
          <>
            <div style={{ marginTop: 12 }}>
              {question.options.map((opt, i) => (
                <button
                  key={i}
                  className={`seg${selectedIndex === i ? " active" : ""}`}
                  style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 8 }}
                  onClick={() => setSelectedIndex(i)}
                  disabled={grading}
                >
                  <b>{OPTION_LETTER[i]}.</b> {opt}
                </button>
              ))}
            </div>
            {gradingError && (
              <div className="error-box" style={{ marginTop: 10 }}>
                {gradingError}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => submitAnswer()} disabled={grading || selectedIndex == null}>
                {grading ? "Checking…" : gradingError ? "Retry" : "Submit answer"}
              </button>
            </div>
          </>
        )}

        {result && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontWeight: 700, color: result.correct ? "var(--forest)" : "var(--maroon)" }}>
              {result.correct
                ? `Correct! +${Math.round(100 * multiplier)} (x${multiplier} combo)`
                : selectedIndex == null
                  ? `Time's up! The correct answer is ${OPTION_LETTER[result.correctIndex]}.`
                  : `Incorrect — the correct answer is ${OPTION_LETTER[result.correctIndex]}.`}
            </p>
            {question.options.map((opt, i) => (
              <div
                key={i}
                style={{
                  padding: "7px 12px",
                  marginBottom: 6,
                  borderRadius: 8,
                  border: "1px solid var(--rule)",
                  background: i === result.correctIndex ? "var(--tint-success)" : i === selectedIndex ? "var(--tint-error)" : "var(--ivory-2)",
                  fontSize: 13.5,
                }}
              >
                <b>{OPTION_LETTER[i]}.</b> {opt}
              </div>
            ))}
            {result.explanation && <p style={{ fontSize: 13.5, marginTop: 8 }}>{result.explanation}</p>}
            <button className="btn btn-primary" onClick={nextQuestion} style={{ marginTop: 8 }}>
              {roundIndex + 1 >= ROUND_LENGTH ? "Finish round →" : "Next question →"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
