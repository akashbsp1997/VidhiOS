"use client";

import { useEffect, useState, useCallback } from "react";

// Fill the Blanks: mains-answer practice as a cloze game -- some of a
// module's already-generated Teach content (one bullet per line) gets
// blanked out, anywhere from a couple of lines to most of the passage, and
// you tap bank chips to fill each blank back in. Built on the same
// zero-AI-per-round, reuse-already-generated-content pattern as
// components/AnswerArchitect.jsx (see app/api/fill-blanks/route.js) --
// additive, alongside AI-graded free-text practice, not a replacement.
export default function FillBlanks() {
  const [round, setRound] = useState(null); // { passageLines, bank, answerKeyRef }
  const [assignments, setAssignments] = useState([]); // bank id per blank index, or null
  const [result, setResult] = useState(null); // { score, correctBankIdByBlank }
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [scoringError, setScoringError] = useState(null);

  const [roundsPlayed, setRoundsPlayed] = useState(0);
  const [bestScore, setBestScore] = useState(0); // session-local high score, like the other games here

  const loadRound = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setScoringError(null);
    setResult(null);
    fetch("/api/fill-blanks")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setLoadError(data.error);
          return;
        }
        setRound(data);
        const blankCount = data.passageLines.filter((l) => l.blank).length;
        setAssignments(new Array(blankCount).fill(null));
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRound();
  }, [loadRound]);

  function bankTextById(id) {
    return round?.bank.find((b) => b.id === id)?.text ?? "";
  }

  function nextEmptyBlankIndex(current) {
    return current.findIndex((a) => a === null);
  }

  function assignChip(bankId) {
    if (result) return;
    const targetIndex = nextEmptyBlankIndex(assignments);
    if (targetIndex === -1) return; // all blanks already filled
    const next = [...assignments];
    next[targetIndex] = bankId;
    setAssignments(next);
    if (nextEmptyBlankIndex(next) === -1) submitRound(next);
  }

  function clearBlank(blankIndex) {
    if (result) return;
    const next = [...assignments];
    next[blankIndex] = null;
    setAssignments(next);
  }

  function submitRound(finalAssignments) {
    setScoring(true);
    setScoringError(null);
    fetch("/api/fill-blanks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answerKeyRef: round.answerKeyRef, assignments: finalAssignments }),
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

  if (loading) return <div className="loading">Preparing your next passage…</div>;

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

  const usedIds = new Set(assignments.filter(Boolean));
  const unusedBank = round.bank.filter((b) => !usedIds.has(b.id));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          📝 Rounds played: <b>{roundsPlayed}</b>
        </span>
        {bestScore > 0 && <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Best this session: {bestScore}%</span>}
      </div>

      <div className="card">
        {round.passageLines.map((line, i) => {
          if (!line.blank) {
            return (
              <p key={i} style={{ fontSize: 14.5, margin: "0 0 8px" }}>
                {line.text}
              </p>
            );
          }
          const filledId = assignments[line.blankIndex];
          const correctId = result?.correctBankIdByBlank?.[line.blankIndex];
          const isCorrect = result && filledId === correctId;
          const showResult = !!result;
          return (
            <p
              key={i}
              onClick={() => !showResult && filledId && clearBlank(line.blankIndex)}
              style={{
                fontSize: 14.5,
                margin: "0 0 8px",
                padding: "6px 10px",
                borderRadius: 6,
                cursor: !showResult && filledId ? "pointer" : "default",
                background: showResult ? (isCorrect ? "var(--tint-success)" : "var(--tint-error)") : filledId ? "var(--ivory-2)" : "transparent",
                border: filledId || showResult ? "1px solid var(--rule)" : "1px dashed var(--rule)",
              }}
            >
              {filledId ? bankTextById(filledId) : `[blank ${line.blankIndex + 1} — tap a point below]`}
              {showResult && !isCorrect && (
                <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
                  Should have been: {bankTextById(correctId)}
                </span>
              )}
            </p>
          );
        })}

        {!result && (
          <>
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>
              Tap a point to fill the next blank (tap a filled blank to clear it):
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {unusedBank.map((b) => (
                <button key={b.id} className="btn" style={{ fontSize: 13 }} onClick={() => assignChip(b.id)} disabled={scoring}>
                  {b.text}
                </button>
              ))}
            </div>
          </>
        )}

        {scoring && <div className="loading" style={{ marginTop: 10 }}>Scoring…</div>}
        {scoringError && (
          <div className="error-box" style={{ marginTop: 10 }}>
            {scoringError}
            <div style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => submitRound(assignments)}>
                Retry scoring
              </button>
            </div>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 10 }}>
            <div className="feedback-score">{result.score}/100</div>
            <button className="btn btn-primary" onClick={loadRound} style={{ marginTop: 8 }}>
              Next round →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
