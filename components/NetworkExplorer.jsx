"use client";

import { useState } from "react";

// Interconnected items sharing one real thread (e.g. Mesolithic sites tied
// to a shared culture) -- a hub-and-spoke radial layout, not a general
// graph (matches every real example given, far simpler to lay out). Tap a
// node to reveal why it connects to the hub. Only rendered when a module's
// Teach call produced real networkData (see lib/ai/generateModules.js) --
// most modules won't have one.
export default function NetworkExplorer({ networkData }) {
  const { hubLabel, nodes } = networkData;
  const [selected, setSelected] = useState(null);
  const [visited, setVisited] = useState(() => new Set());

  const radius = 38; // percent of container
  const positions = nodes.map((_, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
  });

  function selectNode(i) {
    setSelected(i);
    setVisited((prev) => new Set(prev).add(i));
  }

  return (
    <div>
      <div style={{ position: "relative", width: "100%", paddingTop: "85%" }}>
        {/* preserveAspectRatio="none" so this 0-100 viewBox stretches to
            exactly match the percentage-positioned HTML nodes below,
            regardless of the container's actual (compressed) aspect ratio. */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
          {positions.map((p, i) => (
            <line key={i} x1={50} y1={50} x2={p.x} y2={p.y} stroke="var(--rule)" strokeWidth={0.6} />
          ))}
        </svg>

        {/* Hub */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 84,
            textAlign: "center",
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              margin: "0 auto",
              borderRadius: "50%",
              background: "var(--primary)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
            }}
          >
            🕸️
          </div>
          <div style={{ fontSize: 10.5, marginTop: 4, fontWeight: 700 }}>{hubLabel}</div>
        </div>

        {nodes.map((n, i) => {
          const p = positions[i];
          const isVisited = visited.has(i);
          return (
            <button
              key={i}
              onClick={() => selectNode(i)}
              style={{
                position: "absolute",
                left: `${p.x}%`,
                top: `${p.y}%`,
                transform: "translate(-50%, -50%)",
                width: 48,
                height: 48,
                borderRadius: "50%",
                border: selected === i ? "3px solid var(--primary)" : "2px solid var(--rule)",
                background: isVisited ? "var(--accent-green)" : "var(--surface)",
                color: isVisited ? "#fff" : "inherit",
                fontSize: 18,
                cursor: "pointer",
                zIndex: 1,
              }}
              title={n.label}
            >
              {isVisited ? "✓" : "📍"}
            </button>
          );
        })}
      </div>

      <p className="section-hint" style={{ textAlign: "center" }}>
        {visited.size}/{nodes.length} explored -- tap a pin to see how it connects
      </p>

      {selected !== null && (
        <div className="card" style={{ marginTop: 6 }}>
          <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 14 }}>{nodes[selected].label}</h3>
          {nodes[selected].detail && <p style={{ fontSize: 12.5, margin: "0 0 6px" }}>{nodes[selected].detail}</p>}
          {nodes[selected].connectionReason && (
            <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: 0 }}>
              🕸️ Connects to <b>{hubLabel}</b>: {nodes[selected].connectionReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
