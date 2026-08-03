"use client";

import { MODES } from "../lib/rpg/modes.js";

export default function ModeSelector({ modeId, onChange }) {
  return (
    <div className="segmented" style={{ marginBottom: 10 }} role="group" aria-label="Learning mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`seg${modeId === m.id ? " active" : ""}`}
          onClick={() => onChange(m.id)}
          title={m.tagline}
        >
          {m.icon} {m.label}
        </button>
      ))}
    </div>
  );
}
