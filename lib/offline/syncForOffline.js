// lib/offline/syncForOffline.js
//
// Client-side prefetch walker for the offline-PWA plan: warms the service
// worker's runtime cache (public/sw.js) with the next OFFLINE_SYNC_WINDOW_DAYS
// days' worth of Plan/Teach/practice content by simply fetching the same GET
// endpoints the app already calls when a student opens those pages -- no new
// server logic, caching itself happens transparently in the service
// worker's fetch handler (see public/sw.js's ALLOWLISTED_API_PREFIXES,
// which already covers /api/plan, /api/module-lesson, and /api/attempt).
//
// Deliberately conservative: caps how many subtopics one run touches
// (MAX_SUBTOPICS_PER_SYNC) since warming an unopened subtopic's Teach
// content can trigger a real (costly) AI generation call on the server --
// same as a student opening it live for the first time would -- and
// throttles automatic runs (see shouldAutoSync) so a hard refresh doesn't
// repeat that cost every time the app loads. The manual "Sync for offline"
// button (see app/plan/page.jsx) calls syncForOffline() directly, bypassing
// the throttle -- an explicit request from the student to sync right now.
const OFFLINE_SYNC_WINDOW_DAYS = 7;
const MAX_SUBTOPICS_PER_SYNC = 10;
const AUTO_SYNC_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h
const LAST_SYNC_KEY = "vidhios-last-offline-sync";

async function warmSubtopic(subtopicId) {
  // Best-effort -- a failure here (still offline mid-sync, a real server
  // error) shouldn't abort the rest of the walk; move on to the next
  // subtopic instead.
  try {
    await fetch(`/api/module-lesson?subtopicId=${encodeURIComponent(subtopicId)}`);
  } catch {}
  try {
    await fetch(`/api/attempt?subtopicId=${encodeURIComponent(subtopicId)}`);
  } catch {}
}

/**
 * Walks the next OFFLINE_SYNC_WINDOW_DAYS days of /api/plan's "learn" topics
 * and warms each one's Teach content plus a practice question. Returns the
 * number of subtopics it actually touched (0 if nothing needed syncing, or
 * the plan couldn't be loaded -- e.g. onboarding isn't complete yet, or the
 * device is offline right now).
 */
export async function syncForOffline() {
  let planData;
  try {
    // No fromDay/toDay -- /api/plan's own default window (today-2..today+13,
    // see app/api/plan/route.js) already covers today..today+6.
    const res = await fetch("/api/plan");
    planData = await res.json();
  } catch {
    return 0;
  }
  if (planData?.error || !Array.isArray(planData?.days)) return 0;

  const windowEnd = planData.todayDayNumber + OFFLINE_SYNC_WINDOW_DAYS - 1;
  const subtopicIds = [];
  for (const day of planData.days) {
    if (day.day < planData.todayDayNumber || day.day > windowEnd || day.type !== "learn") continue;
    for (const topic of day.topics) {
      if (!subtopicIds.includes(topic.id)) subtopicIds.push(topic.id);
    }
  }

  const toSync = subtopicIds.slice(0, MAX_SUBTOPICS_PER_SYNC);
  for (const id of toSync) {
    await warmSubtopic(id);
  }

  if (typeof localStorage !== "undefined") localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  return toSync.length;
}

/** Whether enough time has passed since the last automatic sync to run another one. */
export function shouldAutoSync() {
  if (typeof localStorage === "undefined") return true;
  const last = Number(localStorage.getItem(LAST_SYNC_KEY) ?? 0);
  return Date.now() - last > AUTO_SYNC_THROTTLE_MS;
}
