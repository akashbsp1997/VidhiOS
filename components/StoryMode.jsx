"use client";

import { useEffect, useState } from "react";
import { themeForSubtopic } from "../lib/rpg/themes.js";
import CharacterScene from "./CharacterScene.jsx";

// Interactive Story Mode (explicit request: "the user is part of the story
// or plays a character, and that way learns the chapter") -- lazily fetched
// once per module (see app/api/module-lesson/story/route.js), then played
// scene by scene entirely client-side. Every choice leads to the same next
// scene (see that route's generation prompt) -- choices give an in-story
// reaction line, not a different path, so every student reliably sees the
// same real content regardless of what they pick.
export default function StoryMode({ subtopicId, moduleIndex, onClose }) {
  const [scenes, setScenes] = useState(null);
  const [error, setError] = useState(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [pickedReaction, setPickedReaction] = useState(null);

  useEffect(() => {
    setScenes(null);
    setError(null);
    setSceneIndex(0);
    setPickedReaction(null);
    fetch(`/api/module-lesson/story?subtopicId=${encodeURIComponent(subtopicId)}&moduleIndex=${moduleIndex}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setScenes(d.scenes)))
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

  if (!scenes) {
    return (
      <div className="card" style={{ marginTop: 10 }}>
        <div className="loading">Writing your story…</div>
      </div>
    );
  }

  const scene = scenes[sceneIndex];
  const isLast = sceneIndex === scenes.length - 1;
  const theme = themeForSubtopic(subtopicId);

  return (
    <div className="card" style={{ marginTop: 10, borderColor: "var(--primary)", animation: "app-nav-drawer-in-up 0.2s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
          🎭 Scene {sceneIndex + 1} of {scenes.length}
        </span>
        <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={onClose}>
          Exit story
        </button>
      </div>

      <CharacterScene guideEmoji={theme.guide.emoji} guideLabel={theme.name} speaker="guide" bubbleKey={`scene-${sceneIndex}`}>
        {scene.sceneText}
      </CharacterScene>

      {!pickedReaction ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {scene.choices.map((c, i) => (
            <button key={i} className="seg" style={{ textAlign: "left" }} onClick={() => setPickedReaction(c.reaction)}>
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <CharacterScene guideEmoji={theme.guide.emoji} guideLabel={theme.name} speaker="user" bubbleKey={`reaction-${sceneIndex}`}>
          {pickedReaction}
        </CharacterScene>
      )}

      {pickedReaction && (
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={() => {
            if (isLast) {
              onClose();
            } else {
              setPickedReaction(null);
              setSceneIndex((i) => i + 1);
            }
          }}
        >
          {isLast ? "Finish the story →" : "Continue →"}
        </button>
      )}
    </div>
  );
}
