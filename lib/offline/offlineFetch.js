// lib/offline/offlineFetch.js
//
// Drop-in replacement for a write flow's raw `fetch(...).then(r => r.json())`
// call. Tries the real network request first; only on an actual network
// failure (offline, DNS, timeout -- never a real HTTP error status, which
// must still surface normally so validation/auth errors aren't silently
// swallowed) does it fall back to queuing the write for later (see
// writeQueue.js). Returns the same parsed-JSON shape either way, with
// `queued: true` added when it was queued instead of actually sent, so a
// caller can show "saved locally" using the same optimistic-save UI this
// app already has for `pending: true` (the 2026-07-24 batch-grading
// change trained every write flow's UI to say "saved, not processed yet"
// -- `queued` is just one more reason that's true).
//
// With NEXT_PUBLIC_OFFLINE_MODE_ENABLED unset, this is byte-for-byte the
// same as a plain fetch+json call -- a network failure rethrows exactly as
// it always has, so nothing changes for any caller until the flag is on.
import { enqueue } from "./writeQueue.js";

export async function offlineFetch(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    const offlineModeEnabled = process.env.NEXT_PUBLIC_OFFLINE_MODE_ENABLED === "true";
    if (!offlineModeEnabled || typeof indexedDB === "undefined") throw err;
    await enqueue(url, body);
    return { queued: true };
  }
}
