// public/sw.js
//
// Hand-rolled, not next-pwa -- small enough to keep full control over the
// caching strategy, and this app's Next.js App Router + Vercel setup
// doesn't need the extra framework. Registered by components/OfflineSupport.jsx,
// itself gated on NEXT_PUBLIC_OFFLINE_MODE_ENABLED so this whole file is
// inert (never registered, never runs) until that flag is turned on.
//
// Scope, deliberately narrow (see the offline-PWA plan):
//  1. Page navigations -- network-first, falling back to whatever was
//     cached the last time that exact URL was visited online, or to
//     /offline.html if it's never been visited.
//  2. GET requests to an ALLOWLISTED set of read-mostly API routes
//     (the "core daily loop" -- plan/teach/practice/current-affairs/etc.,
//     see lib/subjects data this app already treats as "generate once,
//     cache forever") -- same network-first-with-cache-fallback strategy,
//     keyed by the full URL including query string so per-subtopic/
//     per-day requests cache independently.
//  3. Everything else (static Next.js build assets, non-GET requests,
//     non-allowlisted routes, cross-origin requests) is left completely
//     alone -- static assets are already served with long-lived
//     Cache-Control by Next itself, and writes are handled client-side by
//     lib/offline/offlineFetch.js's queue, never by this service worker.
const CACHE_VERSION = "v2";
const SHELL_CACHE = `vidhios-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `vidhios-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [OFFLINE_URL, "/manifest.json", "/icons/icon.svg"];

// Read-mostly API routes worth serving from cache when offline -- the
// "core daily loop" (Plan -> Teach -> practice) plus a few adjacent reads
// already visited from those same pages. Deliberately does NOT include
// every API route in the app (see the offline-PWA plan's F5/out-of-scope
// notes) -- write endpoints are never listed here regardless, since only
// GET requests ever reach the branch that checks this list.
const ALLOWLISTED_API_PREFIXES = [
  "/api/plan",
  "/api/module-lesson",
  "/api/subjects",
  "/api/subtopics",
  "/api/current-affairs",
  "/api/attempt",
  "/api/quant-lesson",
  "/api/flashcards",
  "/api/missions",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Never cache these -- lazily-generated, optional, one-shot enrichment
// (Story Mode, Time-Scene Challenge) that happens to share the
// "/api/module-lesson" prefix with the real allowlisted core-loop route,
// but has no business being served stale offline: each is generated once,
// cached forever in its own DB row, and should always hit the network
// fresh. Found live (2026-08-04): the plain prefix match below was sweeping
// these in too, and something about caching their request/response was
// throwing "The string did not match the expected pattern." in Safari.
const API_GET_DENYLIST_EXACT = ["/api/module-lesson/story", "/api/module-lesson/scene"];

function isAllowlistedApiGet(request, url) {
  if (request.method !== "GET") return false;
  if (API_GET_DENYLIST_EXACT.includes(url.pathname)) return false;
  return ALLOWLISTED_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

// A cache-miss offline API response still needs to be a real Response, not
// a rejected promise -- every page in this app already checks a JSON
// `error` field (see e.g. app/plan/page.jsx's `if (d.error) setError(...)`),
// so this reuses that exact convention instead of surfacing a raw network
// TypeError the client isn't expecting.
function offlineApiFallback() {
  return new Response(JSON.stringify({ error: "offline_not_cached" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

async function networkFirst(request, cacheName, fallbackResponse) {
  let response;
  try {
    response = await fetch(request);
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackResponse) return fallbackResponse();
    throw err;
  }
  // Caching is best-effort and must NEVER be able to turn a successful
  // network response into a failure -- some browsers (Safari's Cache API
  // in particular) can throw on caching a request/response shape they
  // don't like, and that used to fall into the same catch as a real
  // network failure above, silently swapping a real answer for the
  // offline fallback. Separated so a caching hiccup is invisible to the
  // caller: the real response still goes out either way.
  if (response && response.ok) {
    try {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    } catch (err) {
      console.error("sw.js: caching response failed (response still served):", err.message);
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin (Supabase, etc.) -- leave alone

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, RUNTIME_CACHE, () => caches.match(OFFLINE_URL)));
    return;
  }

  if (isAllowlistedApiGet(request, url)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE, offlineApiFallback));
  }
});
