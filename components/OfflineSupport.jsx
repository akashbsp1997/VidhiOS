"use client";

import { useEffect } from "react";

// Registers public/sw.js -- entirely inert unless
// NEXT_PUBLIC_OFFLINE_MODE_ENABLED="true" (a build-time env var, same
// gating convention as this app's other opt-in features). Mounted once from
// app/layout.jsx. Registration failure (e.g. an unsupported browser) is
// swallowed -- the app must keep working normally either way, offline
// support is additive, never required.
export default function OfflineSupport() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_OFFLINE_MODE_ENABLED !== "true") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
