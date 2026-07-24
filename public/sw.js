// Minimal service worker (feature #10 PWA). Network-first for navigations so
// data is always fresh; falls back to a tiny offline message. We intentionally
// do NOT cache API responses (prices/signals must be live).
const OFFLINE = "mr-offline-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(OFFLINE).then((c) =>
      c.put(
        "/offline",
        new Response(
          "<h1 style='font-family:sans-serif;background:#0a0c10;color:#eee;padding:2rem'>Offline — reconnect to load live data.</h1>",
          { headers: { "Content-Type": "text/html" } },
        ),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Never cache API calls — always go to network.
  if (new URL(request.url).pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline")),
    );
  }
});
