/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // app/api/migrate/route.js reads drizzle/*.sql at runtime via
  // drizzle-orm's migrator, not via a static import -- Next's file tracer
  // won't find it on its own, so the migration SQL wouldn't be included in
  // the deployed function bundle without this.
  outputFileTracingIncludes: {
    "/api/migrate": ["./drizzle/**"],
  },
  // /sw.js (the offline-mode service worker, see components/OfflineSupport.jsx)
  // must never be served from a stale HTTP cache -- browsers already
  // re-check it on every navigation, but some CDN/proxy layers cache static
  // files under public/ aggressively by default. no-cache forces a
  // revalidation request every time so a new service worker version is
  // never stuck behind a cached old one.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
