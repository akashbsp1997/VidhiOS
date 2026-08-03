"use client";

import { themeForSubtopic } from "../lib/rpg/themes.js";

// Candy-Crush-style level path (explicit request: "structured flow with
// progression like in candy crush") -- replaces the plain module tab-strip
// with a winding trail of numbered level nodes: locked/current/cleared
// states, connected by a line, each node showing that module's themed
// creature (lib/rpg/themes.js -- same theme as this subtopic's Dragon's
// Challenge and Monster Battle). A straight horizontally-scrollable row
// with alternating vertical offset per node, not true SVG path-drawing --
// gets the same "trail of levels" read without new drawing code.
function lockReasonLabel(reason) {
  if (reason === "previous_test_not_attempted") return "Attempt the previous module's Test first";
  if (reason === "mastery_below_threshold") return "Raise this subtopic's mastery to unlock (updates after tonight's grading)";
  return "Locked";
}

export default function LevelMap({ subtopicId, modules, moduleIndex, onSelect }) {
  const theme = themeForSubtopic(subtopicId);
  const firstLockedIndex = modules.findIndex((m) => m.locked);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 6 }}>
        {theme.guide.emoji} {theme.name}
      </div>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 22,
          overflowX: "auto",
          padding: "22px 8px 30px",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            top: "50%",
            height: 3,
            background: "var(--rule)",
            zIndex: 0,
          }}
        />
        {modules.map((m, i) => {
          const creature = theme.creatures[i % theme.creatures.length];
          const isCurrent = i === moduleIndex;
          const isCleared = !m.locked && i < moduleIndex;
          const offset = i % 2 === 0 ? -12 : 12;
          return (
            <div
              key={m.id}
              style={{ position: "relative", zIndex: 1, flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", transform: `translateY(${offset}px)` }}
            >
              <button
                type="button"
                onClick={() => !m.locked && onSelect(i)}
                disabled={m.locked}
                title={m.locked ? lockReasonLabel(m.lockReason) : `${i + 1}. ${m.title}${m.articleRef ? ` (${m.articleRef})` : ""}`}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  border: isCurrent ? "3px solid var(--primary)" : isCleared ? "3px solid var(--accent-green)" : "3px solid var(--rule)",
                  background: isCleared ? "var(--accent-green)" : isCurrent ? "var(--surface-2)" : "var(--surface)",
                  color: isCleared ? "#fff" : "inherit",
                  boxShadow: isCurrent ? "0 0 0 4px rgba(91, 79, 232, 0.18)" : "var(--shadow)",
                  cursor: m.locked ? "not-allowed" : "pointer",
                  opacity: m.locked ? 0.45 : 1,
                  transform: isCurrent ? "scale(1.12)" : "scale(1)",
                  transition: "transform 0.15s ease",
                }}
              >
                {m.locked ? "🔒" : isCleared ? "✓" : creature.emoji}
              </button>
              <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", color: "var(--ink-soft)", marginTop: 4, whiteSpace: "nowrap" }}>
                {i + 1}. {creature.name}
              </span>
            </div>
          );
        })}
      </div>
      <p className="section-hint" style={{ marginTop: 2, marginBottom: 12 }}>
        Module {moduleIndex + 1} of {modules.length}
        {firstLockedIndex !== -1 && ` — ${firstLockedIndex} of ${modules.length} cleared so far`}
      </p>
    </div>
  );
}
