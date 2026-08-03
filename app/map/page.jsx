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
      title={`${isSelf ? "You" : entry.label}${entry.allianceTag ? ` [${entry.allianceTag}]` : ""} -- ${entry.estateTier.label}, ${entry.matureCount} mature plants, ${Math.round(entry.avgMastery * 100)}% mastery${entry.ornaments.length ? " -- " + entry.ornaments.join(", ") : ""}`}
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
      <span style={{ fontSize: 9.5, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
        {entry.allianceTag && <b>[{entry.allianceTag}] </b>}
        {isSelf ? "You" : entry.label}
      </span>
    </div>
  );
}

const STEP_DEF = [
  { key: "teachDone", icon: "📖", label: "Teach" },
  { key: "currentAffairsDone", icon: "📰", label: "Current affairs" },
  { key: "notesDone", icon: "📝", label: "Notes" },
  { key: "prelimsDone", icon: "❓", label: "Prelims" },
];

function BountyCard({ bounty }) {
  const doneCount = STEP_DEF.filter((s) => bounty[s.key]).length;
  return (
    <div className="card" style={{ marginBottom: 8, borderTop: bounty.bloomed ? "3px solid var(--forest)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
          {bounty.bloomed ? "🌸" : "🎁"} {bounty.topicText}
        </span>
        <a className="btn" style={{ fontSize: 11, padding: "3px 9px" }} href={`/learn/${bounty.subtopicId}`}>
          Open →
        </a>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        {STEP_DEF.map((s) => (
          <span key={s.key} style={{ fontSize: 12, opacity: bounty[s.key] ? 1 : 0.35 }} title={s.label}>
            {bounty[s.key] ? "✅" : s.icon} {s.label}
          </span>
        ))}
      </div>
      {bounty.bloomed ? (
        <p style={{ fontSize: 11.5, color: "var(--forest)", margin: "6px 0 0" }}>Bloomed today! 🌸</p>
      ) : (
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", margin: "6px 0 0" }}>{doneCount}/4 steps -- complete all four to bloom.</p>
      )}
    </div>
  );
}

export default function MapPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [bounties, setBounties] = useState(null);

  useEffect(() => {
    fetch("/api/map")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(e.message));
    fetch("/api/bounties")
      .then((r) => r.json())
      .then((d) => !d.error && setBounties(d.bounties))
      .catch(() => {});
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
          {bounties?.some((b) => !b.bloomed) && (
            <div
              title="Today's bounty is waiting -- see the list below"
              style={{
                position: "absolute",
                left: `${data.me.x * 92 + 4 + 3}%`,
                top: `${data.me.y * 86 + 6 - 6}%`,
                fontSize: 18,
              }}
            >
              🎁
            </div>
          )}
        </div>
      )}

      {data?.nearby.length === 0 && (
        <p className="lede">No one else is in your comparable-preparation band yet -- check back as more aspirants join.</p>
      )}

      <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 20 }}>
        📗 NCERT Master · 📰 Current Affairs Master -- ornaments earned by real study milestones, shown here and in
        the Arena.
      </p>

      <h2>🎁 Today's Bounty</h2>
      <p className="lede">
        Your real plan for today -- teach the content, its current affairs get mapped in automatically, add a note,
        clear a Prelims question. All four blooms the topic and earns a seed bonus.
      </p>
      {bounties == null && <div className="loading">Loading today's bounty…</div>}
      {bounties?.length === 0 && <p className="lede">No learn-day topics assigned for today (a test or revision day) -- no bounty to show.</p>}
      {bounties?.map((b) => (
        <BountyCard key={b.subtopicId} bounty={b} />
      ))}
    </>
  );
}
