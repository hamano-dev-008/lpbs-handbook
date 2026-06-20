// Minimal service worker — required for PWA installability (Add to Home Screen).
// This app reads live data from Google APIs, so we intentionally do NOT cache
// API responses or implement offline fallback; this worker exists only to
// satisfy the browser's installability criteria.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through — always fetch from network, never serve cached/stale data.
  event.respondWith(fetch(event.request));
});
