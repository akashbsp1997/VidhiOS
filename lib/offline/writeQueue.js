// lib/offline/writeQueue.js
//
// The offline write queue backing lib/offline/offlineFetch.js -- a network
// failure on a write (attempt, essay, notes, etc.) queues it here instead
// of losing it; flushQueue replays the backlog once there's a connection
// again. Every write this app has ever accepted has already meant
// "save now, process later" (see the 2026-07-24 overnight-batch-grading
// change) -- this just extends "later" to "whenever the device is next
// online" for the specific case where the initial save itself couldn't
// reach the server.
import { addPendingWrite, getAllPendingWrites, deletePendingWrite } from "./db.js";

export async function enqueue(url, body) {
  await addPendingWrite({ url, method: "POST", body, createdAt: Date.now() });
}

export async function queueDepth() {
  if (typeof indexedDB === "undefined") return 0;
  const rows = await getAllPendingWrites();
  return rows.length;
}

let flushing = false;

/**
 * Replays every queued write in the order it was originally submitted, via
 * a real fetch, so a later write can never land before an earlier one.
 * Stops on the first failure (still offline, or a real server error) and
 * leaves the rest queued rather than skipping ahead and reordering them.
 * Safe to call opportunistically (mount, `online` event) -- a `flushing`
 * guard means overlapping calls just no-op instead of double-sending.
 */
export async function flushQueue() {
  if (typeof indexedDB === "undefined" || flushing) return;
  flushing = true;
  try {
    const rows = (await getAllPendingWrites()).sort((a, b) => a.createdAt - b.createdAt);
    for (const row of rows) {
      try {
        const res = await fetch(row.url, {
          method: row.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(row.body),
        });
        if (!res.ok) break; // a real server error -- stop rather than reorder around it
        await deletePendingWrite(row.id);
      } catch {
        break; // still offline
      }
    }
  } finally {
    flushing = false;
  }
}
