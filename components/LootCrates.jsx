"use client";

import { useState } from "react";

// "Smashing a box reveals an information bullet... that's rare" -- reuses
// this module's already-generated keyPoints verbatim (zero new AI calls,
// zero new schema) as loot, each assigned a deterministic rarity from a
// hash of its own text -- same crate order/rarities every time a student
// reopens this module, not re-rolled per visit.
const RARITY_TIERS = [
  { id: "common", label: "Common", color: "var(--ink-soft)", threshold: 0.6 },
  { id: "uncommon", label: "Uncommon", color: "var(--primary)", threshold: 0.85 },
  { id: "rare", label: "Rare ✨", color: "var(--accent-gold)", threshold: 1 },
];

function hashToUnit(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

function rarityFor(text) {
  const u = hashToUnit(text);
  return RARITY_TIERS.find((t) => u <= t.threshold) ?? RARITY_TIERS[0];
}

export default function LootCrates({ keyPoints }) {
  const [opened, setOpened] = useState(() => new Set());
  const [justSmashed, setJustSmashed] = useState(null);

  function smash(i) {
    if (opened.has(i)) return;
    setJustSmashed(i);
    setTimeout(() => {
      setOpened((prev) => new Set(prev).add(i));
      setJustSmashed(null);
    }, 260);
  }

  return (
    <div>
      <p className="section-hint" style={{ marginBottom: 10 }}>
        Smash every crate to loot this module's key facts -- rarity is fixed per fact, not random each time.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {keyPoints.map((point, i) => {
          const rarity = rarityFor(point);
          const isOpen = opened.has(i);
          const isSmashing = justSmashed === i;
          return (
            <div key={i} style={{ width: 150 }}>
              {!isOpen ? (
                <button
                  type="button"
                  onClick={() => smash(i)}
                  style={{
                    width: "100%",
                    height: 72,
                    borderRadius: "var(--radius)",
                    border: "2px dashed var(--rule)",
                    background: "var(--surface-2)",
                    fontSize: 30,
                    cursor: "pointer",
                    transform: isSmashing ? "scale(0.85) rotate(-4deg)" : "scale(1)",
                    transition: "transform 0.15s ease",
                  }}
                  title="Smash for a fact"
                >
                  📦
                </button>
              ) : (
                <div className="card" style={{ padding: "8px 10px", minHeight: 72, borderTop: `3px solid ${rarity.color}` }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: rarity.color, marginBottom: 3 }}>{rarity.label}</div>
                  <div style={{ fontSize: 12 }}>{point}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {opened.size === keyPoints.length && keyPoints.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--accent-green)", marginTop: 10, fontWeight: 600 }}>
          🏆 All crates looted -- every key fact in this module, collected.
        </p>
      )}
    </div>
  );
}
