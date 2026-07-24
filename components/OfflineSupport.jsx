"use client";

import { useEffect } from "react";
import { flushQueue } from "../lib/offline/writeQueue.js";
import { syncForOffline, shouldAutoSync } from "../lib/offline/syncForOffline.js";

// Registers public/sw.js, flushes the offline write queue (see
// lib/offline/writeQueue.js), and kicks off a throttled prefetch sync (see
// lib/offline/syncForOffline.js) -- entirely inert unless
// NEXT_PUBLIC_OFFLINE_MODE_ENABLED="true" (a build-time env var, same
// gating convention as this app's other opt-in features). Mounted once from
// app/layout.jsx (the App Router root layout persists across navigations,
// so this only actually fires once per real page load, not per route
// change). Registration failure (e.g. an unsupported browser) is
// swallowed -- the app must keep working normally either way, offline
// support is additive, never required.
export default function OfflineSupport() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_OFFLINE_MODE_ENABLED !== "true") return;

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    }

    flushQueue();
    window.addEventListener("online", flushQueue);

    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      if (shouldAutoSync()) syncForOffline();
    }

    return () => window.removeEventListener("online", flushQueue);
  }, []);

  return null;
}
