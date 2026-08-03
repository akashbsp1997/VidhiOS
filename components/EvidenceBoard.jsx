"use client";

import { useState, useMemo } from "react";

// "Clicking a bunch of papers reveals certain details that identify it..."
// -- reveal this module's keyPoints one at a time as clue "papers," then
// guess which real concept they describe from a small multiple-choice set.
// Zero new AI calls: the correct answer is this module's own title, and the
// wrong options are OTHER modules' titles from the same subtopic -- already
// real, related, and genuinely confusable since they're all from the same
// subtopic, with no invented distractors needed.
function hashToUnit(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

// Deterministic shuffle (Fisher-Yates seeded by a hash of the seed string)
// -- same option order every time this module's board is opened, not
// re-shuffled per click.
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

export default function EvidenceBoard({ moduleId, moduleTitle, keyPoints, otherModuleTitles }) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [pickedIndex, setPickedIndex] = useState(null);

  const clues = keyPoints.slice(0, 4);
  const options = useMemo(() => {
    const distractors = otherModuleTitles.slice(0, 3);
    return seededShuffle([moduleTitle, ...distractors], `${moduleId}`);
  }, [moduleId, moduleTitle, otherModuleTitles]);

  if (clues.length === 0 || options.length < 2) {
    return <p className="section-hint">Not enough material for the Evidence Board on this module yet.</p>;
  }

  const allRevealed = revealedCount >= clues.length;

  return (
    <div>
      <p className="section-hint" style={{ marginBottom: 10 }}>
        Reveal the evidence, then identify what it describes.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {clues.map((clue, i) => {
          const revealed = i < revealedCount;
          return (
            <div key={i} style={{ width: 170 }}>
              {revealed ? (
                <div className="card" style={{ padding: "8px 10px", minHeight: 64, fontSize: 12 }}>{clue}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => i === revealedCount && setRevealedCount((c) => c + 1)}
                  disabled={i !== revealedCount}
                  style={{
                    width: "100%",
                    height: 64,
                    borderRadius: "var(--radius)",
                    border: "2px solid var(--rule)",
                    background: "var(--surface-2)",
                    fontSize: 24,
                    cursor: i === revealedCount ? "pointer" : "not-allowed",
                    opacity: i === revealedCount ? 1 : 0.4,
                  }}
                  title={i === revealedCount ? "Reveal this clue" : "Reveal the earlier clues first"}
                >
                  🧾
                </button>
              )}
            </div>
          );
        })}
      </div>

      {allRevealed && (
        <>
          <p style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>What does the evidence describe?</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {options.map((opt, i) => {
              const isCorrect = opt === moduleTitle;
              const showResult = pickedIndex !== null;
              const isPicked = pickedIndex === i;
              return (
                <button
                  key={i}
                  className={`seg${showResult && isCorrect ? " tint-success" : ""}`}
                  style={{
                    textAlign: "left",
                    borderColor: showResult && isCorrect ? "var(--accent-green)" : showResult && isPicked ? "var(--accent-red)" : undefined,
                  }}
                  onClick={() => pickedIndex === null && setPickedIndex(i)}
                  disabled={pickedIndex !== null}
                >
                  {showResult && isCorrect && "✓ "}
                  {showResult && isPicked && !isCorrect && "✗ "}
                  {opt}
                </button>
              );
            })}
          </div>
          {pickedIndex !== null && (
            <p style={{ fontSize: 12.5, marginTop: 8, color: options[pickedIndex] === moduleTitle ? "var(--accent-green)" : "var(--accent-red)" }}>
              {options[pickedIndex] === moduleTitle ? "Case closed -- correctly identified." : `Not quite -- the evidence points to "${moduleTitle}."`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
