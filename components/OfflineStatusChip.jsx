"use client";

import { useEffect, useState } from "react";
import { queueDepth } from "../lib/offline/writeQueue.js";

const POLL_MS = 5000;

// Small persistent topbar indicator (see app/layout.jsx) -- shows when the
// device is offline, or when there are answers/notes saved locally but not
// yet synced (see lib/offline/writeQueue.js), so a low-connectivity student
// always has an honest read on their state. Hidden entirely when online
// with nothing pending, and hidden entirely unless
// NEXT_PUBLIC_OFFLINE_MODE_ENABLED is on, matching every other offline-mode
// UI piece in this app.
export default function OfflineStatusChip() {
  const [online, setOnline] = useState(true);
  const [depth, setDepth] = useState(0);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_OFFLINE_MODE_ENABLED !== "true") return;

    setOnline(navigator.onLine);
    const refreshDepth = () => queueDepth().then(setDepth);
    refreshDepth();

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Polling, not an event bus -- the queue also changes from
    // components/OfflineSupport.jsx's background flush, which this
    // component has no direct handle on; a 5s poll is cheap and simple
    // enough not to warrant a pub/sub layer for this one indicator.
    const interval = setInterval(refreshDepth, POLL_MS);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(interval);
    };
  }, []);

  if (process.env.NEXT_PUBLIC_OFFLINE_MODE_ENABLED !== "true") return null;
  if (online && depth === 0) return null;

  return (
    <span
      style={{
        fontSize: 12,
        padding: "3px 9px",
        borderRadius: 999,
        border: "1px solid var(--rule)",
        background: online ? "var(--ivory-2)" : "var(--ivory-3)",
        color: "var(--ink-soft)",
        whiteSpace: "nowrap",
      }}
    >
      {online ? "🟢 Online" : "🔴 Offline"}
      {depth > 0 ? ` · ${depth} waiting to sync` : ""}
    </span>
  );
}
