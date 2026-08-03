"use client";

import { useEffect, useState } from "react";

const ESTATE_ICON = { garden: "🌱", orchard: "🌳", farm: "🌾", forest: "🌲" };
const ORNAMENT_ICON = { "NCERT Master": "📗", "Current Affairs Master": "📰" };

function Pin({ entry, isSelf }) {
  // Bigger pin for a bigger estate -- the size IS the preparation-level
  // signal, same idea as the design doc's original "size of estates" ask.
  const size = 22 + entry.matureCount * 1.5;
  return (
    <div
      title={`${isSelf ? "You" : entry.label} -- ${entry.estateTier.label}, ${entry.matureCount} mature plants, ${Math.round(entry.avgMastery * 100)}% mastery${entry.ornaments.length ? " -- " + entry.ornaments.join(", ") : ""}`}
      style={{
        position: "absolute",
        left: `${entry.x * 92 + 4}%`,
        top: `${entry.y * 86 + 6}%`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: Math.min(size, 44),
          filter: isSelf ? "drop-shadow(0 0 6px var(--leather))" : undefined,
        }}
      >
        {ESTATE_ICON[entry.estateTier.id]}
      </span>
      {entry.ornaments.length > 0 && (
        <span style={{ fontSize: 11 }}>{entry.ornaments.map((o) => ORNAMENT_ICON[o] ?? "🏅").join("")}</span>
      )}
      <span style={{ fontSize: 9.5, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{isSelf ? "You" : entry.label}</span>
    </div>
  );
}

export default function MapPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/map")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>🗺️ World Map</h1>
      <p className="lede">
        A virtual map, not a real one -- no location is ever collected. Position left-to-right is preparation
        progress; estate size and ornaments are the same ones shown in the Arena.
      </p>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && <div className="loading">Charting the map…</div>}

      {data && (
        <div
          className="card"
          style={{
            position: "relative",
            height: 360,
            overflow: "hidden",
            background: "linear-gradient(135deg, var(--ivory-2), var(--ivory-3))",
            marginBottom: 16,
          }}
        >
          <Pin entry={data.me} isSelf />
          {data.nearby.map((entry) => (
            <Pin key={entry.userId} entry={entry} isSelf={false} />
          ))}
        </div>
      )}

      {data?.nearby.length === 0 && (
        <p className="lede">No one else is in your comparable-preparation band yet -- check back as more aspirants join.</p>
      )}

      <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>
        📗 NCERT Master · 📰 Current Affairs Master -- ornaments earned by real study milestones, shown here and in
        the Arena.
      </p>
    </>
  );
}
