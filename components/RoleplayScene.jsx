"use client";

import { useEffect, useState } from "react";

// Roleplay Mode -- "the user can be one of the parties," but the scene
// TYPE adapts to whatever the module actually is (courtroom, parliamentary
// debate, diplomatic negotiation, historical dialogue, deliberation, ...) --
// the AI's own judgment call per module (see lib/ai/generateModules.js's
// generateModuleRoleplay), not a fixed courtroom-only shape. Offered on
// every module, lazily fetched once (see app/api/module-lesson/roleplay/route.js).
// Not CharacterScene-based -- two-role-plus-resolution is a genuinely
// different shape from CharacterScene's fixed guide+"you" pair (see
// components/CharacterScene.jsx) -- but reuses its CSS conventions
// (character-bob idle animation, the bubble-pop reveal). Picking a side is
// framing only: both roles' real positions are always shown and the
// resolution is fixed, never generated per-choice.
export default function RoleplayScene({ subtopicId, moduleIndex, onClose }) {
  const [scene, setScene] = useState(null);
  const [error, setError] = useState(null);
  const [pickedSide, setPickedSide] = useState(null);
  const [resolutionShown, setResolutionShown] = useState(false);

  useEffect(() => {
    fetch(`/api/module-lesson/roleplay?subtopicId=${encodeURIComponent(subtopicId)}&moduleIndex=${moduleIndex}`)
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
        <div className="loading">🎬 Setting the scene…</div>
      </div>
    );
  }

  function rolePanel(role, side, emoji) {
    const active = pickedSide === null || pickedSide === side;
    return (
      <div
        className="card"
        style={{
          flex: 1,
          minWidth: 200,
          background: "var(--surface-2)",
          opacity: active ? 1 : 0.5,
          transition: "opacity 0.2s",
          borderColor: pickedSide === side ? "var(--primary)" : undefined,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div className="character-bob" style={{ fontSize: 34 }}>{emoji}</div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{role.label}</div>
        </div>
        <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          {role.positions.map((p, i) => (
            <li key={i} style={{ marginBottom: 4 }}>{p}</li>
          ))}
        </ul>
        {pickedSide === null && (
          <button className="btn" style={{ marginTop: 10, fontSize: 11, width: "100%" }} onClick={() => setPickedSide(side)}>
            Play this role
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 10, borderColor: "var(--primary)", animation: "app-nav-drawer-in-up 0.2s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>🎬 {scene.scenarioLabel}</span>
        <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={onClose}>
          Exit
        </button>
      </div>
      {scene.setting && <p style={{ fontSize: 13, fontStyle: "italic", margin: "6px 0 10px" }}>{scene.setting}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        {rolePanel(scene.roleA, "A", "🙋")}
        {rolePanel(scene.roleB, "B", "🙋‍♂️")}
      </div>

      {pickedSide && !resolutionShown && (
        <button className="btn btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={() => setResolutionShown(true)}>
          Reach the {scene.resolution.label.toLowerCase()} →
        </button>
      )}

      {resolutionShown && (
        <div
          className="card"
          style={{ marginTop: 12, background: "var(--surface-2)", animation: "bubble-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          <p style={{ fontWeight: 600, marginBottom: 4 }}>{scene.resolution.label}</p>
          <p style={{ fontSize: 13.5, margin: 0 }}>{scene.resolution.text}</p>
          <button className="btn" style={{ marginTop: 10 }} onClick={onClose}>
            Done →
          </button>
        </div>
      )}
    </div>
  );
}
