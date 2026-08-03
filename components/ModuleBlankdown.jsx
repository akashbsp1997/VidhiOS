"use client";

import { useEffect, useState, useRef } from "react";
import { bulletLines } from "../lib/text/bullets.js";

// Rapidfire's "blankdown" -- a fast, module-scoped cloze round built
// entirely client-side from teachContent/keyPoints already loaded (no AI
// call, no backend route, no schema): a handful of this module's own
// bullet lines get blanked, tap bank chips to fill them back in, against a
// short clock. Same line-level blanking idea as the standalone Fill the
// Blanks game (app/api/fill-blanks), just scoped to THIS module and timed
// for speed instead of drawn from a random module across the whole app.
const ROUND_SECONDS = 45;
const MAX_BLANKS = 5;

function hashToUnit(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

function shuffleDeterministic(arr, seed) {
  const out = arr.map((v, i) => [hashToUnit(`${seed}-${i}`), v]);
  out.sort((a, b) => a[0] - b[0]);
  return out.map(([, v]) => v);
}

export default function ModuleBlankdown({ moduleId, teachContent, onDone }) {
  const lines = bulletLines(teachContent);
  const blankCount = Math.min(MAX_BLANKS, Math.max(1, Math.floor(lines.length / 2)));
  // Deterministic per-module blank selection -- same lines blanked every
  // time this module's blankdown is played, not re-rolled per attempt.
  const blankedIndices = shuffleDeterministic(
    lines.map((_, i) => i),
    `${moduleId}-blanks`
  ).slice(0, blankCount);
  const blankSet = new Set(blankedIndices);
  const bank = shuffleDeterministic(
    blankedIndices.map((i) => lines[i]),
    `${moduleId}-bank`
  );

  const [assignments, setAssignments] = useState(() => new Array(blankedIndices.length).fill(null));
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [submitted, setSubmitted] = useState(false);
  const submitRef = useRef(null);

  function submit() {
    setSubmitted(true);
  }
  submitRef.current = submit;

  useEffect(() => {
    if (submitted) return;
    if (timeLeft <= 0) {
      submitRef.current?.();
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, submitted]);

  function assignChip(chipText) {
    if (submitted) return;
    const targetIndex = assignments.findIndex((a) => a === null);
    if (targetIndex === -1) return;
    const next = [...assignments];
    next[targetIndex] = chipText;
    setAssignments(next);
    if (next.every((a) => a !== null)) setTimeout(submit, 200);
  }

  function clearBlank(i) {
    if (submitted) return;
    const next = [...assignments];
    next[i] = null;
    setAssignments(next);
  }

  const usedChips = new Set(assignments.filter(Boolean));
  const correctCount = submitted ? assignments.filter((a, i) => a === lines[blankedIndices[i]]).length : 0;
  const timerPct = Math.max(0, Math.min(100, (timeLeft / ROUND_SECONDS) * 100));

  return (
    <div>
      {!submitted && (
        <div className="bar" style={{ marginBottom: 10 }} title={`${timeLeft}s left`}>
          <span style={{ width: `${timerPct}%`, background: timeLeft <= 10 ? "var(--maroon)" : undefined }} />
        </div>
      )}

      <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
        {lines.map((line, i) => {
          if (!blankSet.has(i)) return <div key={i}>{line}</div>;
          const blankIndex = blankedIndices.indexOf(i);
          const filled = assignments[blankIndex];
          const isCorrect = submitted && filled === line;
          return (
            <div
              key={i}
              onClick={() => clearBlank(blankIndex)}
              style={{
                cursor: submitted ? "default" : "pointer",
                padding: "3px 6px",
                borderRadius: 6,
                border: "1px dashed var(--rule)",
                background: submitted ? (isCorrect ? "var(--accent-green)" : "var(--maroon)") : filled ? "var(--surface-2)" : "transparent",
                color: submitted ? "#fff" : "inherit",
                marginBottom: 3,
              }}
            >
              {filled || `___ (blank ${blankIndex + 1})`}
              {submitted && !isCorrect && <div style={{ fontSize: 11, opacity: 0.9 }}>Correct: {line}</div>}
            </div>
          );
        })}
      </div>

      {!submitted && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {bank.map((chip, i) => (
            <button key={i} className="seg" style={{ fontSize: 11.5 }} disabled={usedChips.has(chip)} onClick={() => assignChip(chip)}>
              {chip}
            </button>
          ))}
        </div>
      )}

      {submitted && (
        <div className="card" style={{ borderColor: "var(--accent-green)" }}>
          <p className="feedback-score" style={{ margin: 0 }}>
            {correctCount}/{blankedIndices.length}
          </p>
          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={onDone}>
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}
