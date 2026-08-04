"use client";

import { useEffect, useState } from "react";
import { themeForSubtopic } from "../lib/rpg/themes.js";
import CharacterScene from "./CharacterScene.jsx";

// "An apparition into a location of the real world... asked to identify
// specifics like during which revolution or which part of the world/
// society this is tied to." Lazily fetched once per module (see
// app/api/module-lesson/scene/route.js), a vividly-written scene (not an
// image -- this app's image generation is deliberately flat-diagram-style)
// followed by a known-answer multiple choice, graded entirely client-side.
export default function TimeSceneChallenge({ subtopicId, moduleIndex, onClose }) {
  const [scene, setScene] = useState(null);
  const [error, setError] = useState(null);
  const [pickedIndex, setPickedIndex] = useState(null);
  const theme = themeForSubtopic(subtopicId);

  useEffect(() => {
    fetch(`/api/module-lesson/scene?subtopicId=${encodeURIComponent(subtopicId)}&moduleIndex=${moduleIndex}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setScene(d.scene)))
      .catch((e) => setError(e.message));
  }, [subtopicId, moduleIndex]);

  if (error) {
    return (
      <div className="card" style={{ marginTop: 10, borderColor: "var(--maroon)" }}>
        <p className="lede" style={{ marginBottom: 8 }}>{error}</p>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    );
  }

  if (!scene) {
    return (
      <div className="card" style={{ marginTop: 10 }}>
        <div className="loading">{theme.guide.emoji} The scene shimmers into focus…</div>
      </div>
    );
  }

  const answered = pickedIndex !== null;
  const isCorrect = answered && pickedIndex === scene.correctIndex;

  return (
    <div className="card" style={{ marginTop: 10, borderColor: "var(--primary)", animation: "app-nav-drawer-in-up 0.2s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>🌀 Time-Scene Challenge</span>
        <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={onClose}>
          Exit
        </button>
      </div>

      <CharacterScene guideEmoji={theme.guide.emoji} guideLabel={theme.name} speaker="guide" bubbleKey="scene">
        <span style={{ fontStyle: "italic" }}>{scene.sceneText}</span>
      </CharacterScene>

      <p style={{ fontWeight: 600, marginTop: 10, marginBottom: 6 }}>{scene.question}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {scene.options.map((opt, i) => {
          const showResult = answered;
          const isThisCorrect = i === scene.correctIndex;
          const isThisPicked = i === pickedIndex;
          return (
            <button
              key={i}
              className={`seg${showResult && isThisCorrect ? " tint-success" : ""}`}
              style={{
                textAlign: "left",
                borderColor: showResult && isThisCorrect ? "var(--accent-green)" : showResult && isThisPicked ? "var(--accent-red)" : undefined,
              }}
              onClick={() => !answered && setPickedIndex(i)}
              disabled={answered}
            >
              {showResult && isThisCorrect && "✓ "}
              {showResult && isThisPicked && !isThisCorrect && "✗ "}
              {opt}
            </button>
          );
        })}
      </div>

      {answered && (
        <>
          <p style={{ fontSize: 12.5, marginTop: 8, color: isCorrect ? "var(--accent-green)" : "var(--accent-red)" }}>
            {isCorrect ? "Correct." : "Not quite."} {scene.explanation}
          </p>
          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={onClose}>
            Done →
          </button>
        </>
      )}
    </div>
  );
}
