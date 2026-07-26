"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// Answer Architect: mains-answer practice as a swipe/touch game instead of
// free-text + AI grading -- one bullet point at a time, swipe right to KEEP
// it in your answer or left to DISCARD it as a distractor. Built on content
// this app has already generated once for regular module practice
// (lessonModules.exercises[].modelAnswer, see app/api/answer-architect/route.js) --
// zero AI calls per round, unlike every other practice mode here. Additive,
// alongside AI-graded free-text practice, not a replacement for it (see the
// 2026-07-24 plan doc) -- writing a full answer and getting AI feedback is
// still what components/PracticeSession.jsx is for.
const SWIPE_THRESHOLD = 90;

export default function AnswerArchitect() {
  const [round, setRound] = useState(null); // { questionText, bullets, answerKeyRef }
  const [cursor, setCursor] = useState(0); // index into round.bullets -- the current card
  const [decisions, setDecisions] = useState({}); // { [bulletId]: "kept" | "discarded" }
  const [result, setResult] = useState(null); // { score, correctIds, distractorIds }
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [scoringError, setScoringError] = useState(null);

  const [roundsPlayed, setRoundsPlayed] = useState(0);
  const [bestScore, setBestScore] = useState(0); // session-local high score, like Quant Puzzle Chain's bestChain

  const [dragX, setDragX] = useState(0);
  const dragState = useRef(null); // { startX, pointerId } while a drag is in progress

  const loadRound = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setScoringError(null);
    setResult(null);
    setDecisions({});
    setCursor(0);
    setDragX(0);
    fetch("/api/answer-architect")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setLoadError(data.error);
        else setRound(data);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRound();
  }, [loadRound]);

  function submitRound(finalDecisions) {
    setScoring(true);
    setScoringError(null);
    const keptBulletIds = Object.entries(finalDecisions)
      .filter(([, d]) => d === "kept")
      .map(([id]) => id);
    fetch("/api/answer-architect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answerKeyRef: round.answerKeyRef, keptBulletIds }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setScoringError(data.error);
          return;
        }
        setResult(data);
        setRoundsPlayed((n) => n + 1);
        setBestScore((b) => Math.max(b, data.score));
      })
      .catch((e) => setScoringError(e.message))
      .finally(() => setScoring(false));
  }

  function decide(direction) {
    // direction: "kept" (swipe right / Keep) | "discarded" (swipe left / Discard)
    const bullet = round.bullets[cursor];
    const next = { ...decisions, [bullet.id]: direction };
    setDecisions(next);
    setDragX(0);
    if (cursor + 1 >= round.bullets.length) {
      submitRound(next);
    } else {
      setCursor((c) => c + 1);
    }
  }

  function onPointerDown(e) {
    dragState.current = { startX: e.clientX, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragState.current) return;
    setDragX(e.clientX - dragState.current.startX);
  }
  function onPointerUp() {
    if (!dragState.current) return;
    dragState.current = null;
    if (dragX > SWIPE_THRESHOLD) decide("kept");
    else if (dragX < -SWIPE_THRESHOLD) decide("discarded");
    else setDragX(0);
  }

  if (loading) return <div className="loading">Preparing your next round…</div>;

  if (loadError)
    return (
      <div className="error-box">
        {loadError}
        <div style={{ marginTop: 8 }}>
          <button className="btn" onClick={loadRound}>
            Try again
          </button>
        </div>
      </div>
    );

  if (!round) return null;

  const currentBullet = round.bullets[cursor];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          🧩 Rounds played: <b>{roundsPlayed}</b>
        </span>
        {bestScore > 0 && <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Best this session: {bestScore}%</span>}
      </div>

      <div className="card">
        <div className="question-text">{round.questionText}</div>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
          Swipe (or tap) each point right to KEEP it in your answer, left to DISCARD it as filler/off-topic.
        </p>

        {!result && currentBullet && (
          <>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 10 }}>
              Point {cursor + 1} of {round.bullets.length}
            </div>
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                dragState.current = null;
                setDragX(0);
              }}
              style={{
                marginTop: 8,
                padding: "18px 16px",
                borderRadius: 10,
                border: "1px solid var(--rule)",
                background: dragX > 20 ? "var(--tint-success)" : dragX < -20 ? "var(--tint-error)" : "var(--ivory-2)",
                fontSize: 14.5,
                touchAction: "pan-y",
                cursor: "grab",
                transform: `translateX(${dragX}px) rotate(${dragX / 20}deg)`,
                transition: dragState.current ? "none" : "transform 0.2s, background 0.2s",
                userSelect: "none",
              }}
            >
              {currentBullet.text}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => decide("discarded")}>
                ← Discard
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => decide("kept")}>
                Keep →
              </button>
            </div>
          </>
        )}

        {scoring && <div className="loading" style={{ marginTop: 10 }}>Scoring…</div>}
        {scoringError && (
          <div className="error-box" style={{ marginTop: 10 }}>
            {scoringError}
            <div style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => submitRound(decisions)}>
                Retry scoring
              </button>
            </div>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 10 }}>
            <div className="feedback-score">{result.score}/100</div>
            {round.bullets.map((b) => {
              const shouldKeep = result.correctIds.includes(b.id);
              const kept = decisions[b.id] === "kept";
              const gotItRight = kept === shouldKeep;
              return (
                <div
                  key={b.id}
                  style={{
                    padding: "7px 12px",
                    marginBottom: 6,
                    borderRadius: 8,
                    border: "1px solid var(--rule)",
                    background: gotItRight ? "var(--tint-success)" : "var(--tint-error)",
                    fontSize: 13.5,
                  }}
                >
                  {shouldKeep ? "✓ Belongs in the answer" : "✗ Distractor"} — you {kept ? "kept" : "discarded"} it
                  {gotItRight ? "" : " (wrong)"}
                  <div style={{ marginTop: 2 }}>{b.text}</div>
                </div>
              );
            })}
            <button className="btn btn-primary" onClick={loadRound} style={{ marginTop: 8 }}>
              Next round →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
