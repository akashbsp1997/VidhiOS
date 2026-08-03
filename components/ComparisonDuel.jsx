"use client";

import { useState, useMemo } from "react";

// "India vs World" comparisons, as a real minigame -- reveal each
// attribute row as a versus card, then a quick "which side" quiz built
// from the SAME rows (zero extra AI calls). Only rendered when a module's
// Teach call produced real comparisonData (see lib/ai/generateModules.js) --
// most modules won't have one, this is never forced.
function hashToUnit(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

function seededShuffle(arr, seed) {
  const out = [...arr];
  let s = Math.floor(hashToUnit(seed) * 1_000_000);
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function ComparisonDuel({ moduleId, comparisonData }) {
  const { leftLabel, rightLabel, rows } = comparisonData;
  const [revealedCount, setRevealedCount] = useState(0);
  const [quizIndex, setQuizIndex] = useState(0);
  const [pickedSide, setPickedSide] = useState(null);
  const [quizDone, setQuizDone] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);

  // Each quiz question shows one side's real value and asks which label it
  // belongs to -- shuffled per-module (stable, not re-rolled every visit).
  const quizItems = useMemo(() => {
    const items = rows.map((r) => ({
      attribute: r.attribute,
      value: hashToUnit(`${moduleId}-${r.attribute}`) < 0.5 ? r.left : r.right,
      correctSide: hashToUnit(`${moduleId}-${r.attribute}`) < 0.5 ? "left" : "right",
    }));
    return seededShuffle(items, `${moduleId}-quiz`).slice(0, 5);
  }, [rows, moduleId]);

  const allRevealed = revealedCount >= rows.length;

  function pick(side) {
    if (pickedSide !== null) return;
    setPickedSide(side);
    if (side === quizItems[quizIndex].correctSide) setCorrectCount((c) => c + 1);
  }

  function nextQuizItem() {
    if (quizIndex + 1 >= quizItems.length) {
      setQuizDone(true);
      return;
    }
    setQuizIndex((i) => i + 1);
    setPickedSide(null);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="tier-pill" style={{ background: "var(--primary)", color: "#fff" }}>
          {leftLabel}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>VS</span>
        <span className="tier-pill" style={{ background: "var(--accent-gold)" }}>
          {rightLabel}
        </span>
      </div>

      {!allRevealed && (
        <>
          {rows.slice(0, revealedCount + 1).map((r, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>{r.attribute}</div>
              {i < revealedCount ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 12.5 }}>{r.left}</div>
                  <div style={{ width: 1, background: "var(--rule)" }} />
                  <div style={{ flex: 1, fontSize: 12.5 }}>{r.right}</div>
                </div>
              ) : (
                <button className="btn" style={{ fontSize: 12 }} onClick={() => setRevealedCount((c) => c + 1)}>
                  Reveal →
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {allRevealed && !quizDone && (
        <div className="card">
          <p style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>
            "{quizItems[quizIndex].attribute}: {quizItems[quizIndex].value}" -- which side is this?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            {["left", "right"].map((side) => {
              const showResult = pickedSide !== null;
              const isCorrectSide = side === quizItems[quizIndex].correctSide;
              return (
                <button
                  key={side}
                  className={`btn${showResult && isCorrectSide ? " btn-primary" : ""}`}
                  style={{ flex: 1 }}
                  onClick={() => pick(side)}
                  disabled={showResult}
                >
                  {showResult && isCorrectSide && "✓ "}
                  {side === "left" ? leftLabel : rightLabel}
                </button>
              );
            })}
          </div>
          {pickedSide !== null && (
            <button className="btn" style={{ marginTop: 10 }} onClick={nextQuizItem}>
              {quizIndex + 1 >= quizItems.length ? "See results →" : "Next →"}
            </button>
          )}
        </div>
      )}

      {quizDone && (
        <div className="card" style={{ borderColor: "var(--accent-green)" }}>
          <p className="feedback-score" style={{ margin: 0 }}>
            {correctCount}/{quizItems.length}
          </p>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: 0 }}>correctly matched to the right side</p>
        </div>
      )}
    </div>
  );
}
