"use client";

import { useEffect, useState } from "react";

const MISSION_ICON = { learn: "📖", practice: "✍️", pass: "🎯" };
const ITEM_ICON = { unlock_pass: "🎟", lockdown_grace: "🎫", cosmetic_badge: "🏅" };

// Dashboard widget for the daily-missions/XP/streak/inventory layer (see
// lib/gamification/*) -- purely a display + "here's what you earned" panel;
// missions are actually completed as a side effect of real study/practice
// actions elsewhere in the app (recordMissionSafe), never marked done here.
const LAST_SEEN_XP_KEY = "vidhios-last-seen-xp";

export default function MissionsPanel() {
  const [missions, setMissions] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [usableItems, setUsableItems] = useState([]);
  const [badgeCount, setBadgeCount] = useState(0);
  // Purely cosmetic "you earned XP since you were last here" pulse -- this
  // widget only fetches once on mount, it has no live channel to a mission
  // completing elsewhere in the app mid-session, so this compares against
  // the last value this browser saw (localStorage) rather than claiming to
  // detect the exact moment a mission completes.
  const [xpJustIncreased, setXpJustIncreased] = useState(false);

  useEffect(() => {
    fetch("/api/missions")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setMissions(data.missions);
          setPlayerState(data.playerState);
          if (typeof localStorage !== "undefined") {
            const lastSeen = Number(localStorage.getItem(LAST_SEEN_XP_KEY) ?? 0);
            if (data.playerState.xp > lastSeen) setXpJustIncreased(true);
            localStorage.setItem(LAST_SEEN_XP_KEY, String(data.playerState.xp));
          }
        }
      })
      .catch(() => {});
    fetch("/api/items")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setUsableItems(data.usableItems ?? []);
          setBadgeCount((data.badges ?? []).length);
        }
      })
      .catch(() => {});
  }, []);

  if (!missions || !playerState) return null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <h2 style={{ margin: 0 }}>Today's missions</h2>
        <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
          ⭐ <span className={xpJustIncreased ? "value-pop" : undefined}>{playerState.xp} XP</span> · 🔥 {playerState.currentStreakDays}-day streak
          {playerState.longestStreakDays > playerState.currentStreakDays ? ` (best ${playerState.longestStreakDays})` : ""}
        </span>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {missions.map((m) => (
          <li key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", opacity: m.completed ? 0.65 : 1 }}>
            <span>{m.completed ? "✅" : MISSION_ICON[m.key]}</span>
            <span style={{ fontSize: 13.5, textDecoration: m.completed ? "line-through" : "none" }}>{m.label}</span>
          </li>
        ))}
      </ul>

      {(usableItems.length > 0 || badgeCount > 0) && (
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 8, marginBottom: 0 }}>
          Inventory:{" "}
          {usableItems.map((i) => `${ITEM_ICON[i.itemType]} ${i.label}`).join(", ") || "—"}
          {usableItems.length > 0 && badgeCount > 0 ? " · " : ""}
          {badgeCount > 0 && `🏅 ${badgeCount} badge${badgeCount === 1 ? "" : "s"} earned`}
        </p>
      )}

      <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6, marginBottom: 0 }}>
        Missions reward a random item — an early-access pass for a locked topic, a lockdown grace token, or a
        cosmetic badge. Use passes/tokens right where they apply (a locked subtopic, or a lockdown notice).
      </p>
    </div>
  );
}
