"use client";

import { useEffect, useState } from "react";

// Courtroom Mode -- "a case is described, we can show a courtroom and two
// labeled parties both showing their prominent arguments and after that
// judge pronouncing the verdict." Lazily fetched once per module (see
// app/api/module-lesson/courtroom/route.js), only offered when the
// subtopic has a real case in db/seed/cases.js. Not CharacterScene-based --
// a two-party-adversarial-plus-verdict layout is a genuinely different
// shape from CharacterScene's fixed guide+"you" pair (see
// components/CharacterScene.jsx), so this reuses its CSS conventions
// (character-bob idle animation, the bubble-pop reveal, app/globals.css)
// rather than trying to force three roles through a two-slot component.
// "The user can be one of the parties" is framing only here -- picking a
// side highlights that party's panel, it never changes which arguments are
// shown or the verdict, which is always the case's real, fixed outcome.
export default function CourtroomScene({ subtopicId, moduleIndex, onClose }) {
  const [scene, setScene] = useState(null);
  const [error, setError] = useState(null);
  const [pickedSide, setPickedSide] = useState(null);
  const [verdictShown, setVerdictShown] = useState(false);

  useEffect(() => {
    fetch(`/api/module-lesson/courtroom?subtopicId=${encodeURIComponent(subtopicId)}&moduleIndex=${moduleIndex}`)
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
        <div className="loading">⚖️ The court is convening…</div>
      </div>
    );
  }

  function partyPanel(party, side, emoji) {
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
          <div style={{ fontWeight: 600, fontSize: 13 }}>{party.label}</div>
        </div>
        <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          {party.arguments.map((a, i) => (
            <li key={i} style={{ marginBottom: 4 }}>{a}</li>
          ))}
        </ul>
        {pickedSide === null && (
          <button className="btn" style={{ marginTop: 10, fontSize: 11, width: "100%" }} onClick={() => setPickedSide(side)}>
            Argue for this side
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 10, borderColor: "var(--primary)", animation: "app-nav-drawer-in-up 0.2s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>⚖️ Courtroom</span>
        <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={onClose}>
          Exit
        </button>
      </div>
      <h2 style={{ margin: "0 0 2px" }}>{scene.caseName}</h2>
      {scene.courtName && <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 10px" }}>{scene.courtName}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        {partyPanel(scene.partyA, "A", "🙋")}
        {partyPanel(scene.partyB, "B", "🙋‍♂️")}
      </div>

      {pickedSide && !verdictShown && (
        <button className="btn btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={() => setVerdictShown(true)}>
          👨‍⚖️ Pronounce the verdict →
        </button>
      )}

      {verdictShown && (
        <div
          className="card"
          style={{ marginTop: 12, background: "var(--surface-2)", animation: "bubble-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          <p style={{ fontWeight: 600, marginBottom: 4 }}>👨‍⚖️ Verdict</p>
          <p style={{ fontSize: 13.5, marginBottom: scene.verdict.reasoning ? 6 : 0 }}>{scene.verdict.holding}</p>
          {scene.verdict.reasoning && (
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: 0 }}>{scene.verdict.reasoning}</p>
          )}
          <button className="btn" style={{ marginTop: 10 }} onClick={onClose}>
            Done →
          </button>
        </div>
      )}
    </div>
  );
}
