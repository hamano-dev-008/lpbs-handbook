// Service worker — PWA installability + app-shell caching + update notification.
// Naikkan APP_VERSION serentak dengan APP_VERSION dalam index.html setiap deploy;
// nama cache berversi memastikan cache lama dibuang bersih semasa activate.
// Data Google API (Calendar/Sheets) TIDAK dicache — sentiasa live dari network.

const APP_VERSION = '1.0.20';
const CACHE_NAME = 'padiapp-v' + APP_VERSION;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  // no-store: pastikan shell yang dicache adalah versi terkini dari network,
  // bukan salinan basi dari HTTP cache pelayar/CDN.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'no-store' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldKeys = keys.filter((k) => k.startsWith('padiapp-') && k !== CACHE_NAME);
    await Promise.all(oldKeys.map((k) => caches.delete(k)));
    await self.clients.claim();
    // Cache lama wujud => klien yang sedang berjalan memuatkan versi lama.
    if (oldKeys.length > 0) notifyClientsUpdateAvailable();
  })());
});

function notifyClientsUpdateAvailable() {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((c) => c.postMessage({ type: 'UPDATE_AVAILABLE', version: APP_VERSION }));
  });
}

function isShellRequest(request, url) {
  if (request.mode === 'navigate') return true;
  return url.pathname.endsWith('/manifest.json') || url.pathname.includes('/icons/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Bukan GET atau bukan origin sendiri (Google APIs, CDN, fonts) — terus ke network.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !isShellRequest(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell: cache-first (paparan segera), semak network di latar belakang.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });

    // Guna URL (bukan Request mod 'navigate' — Cache.put menolaknya) dan
    // no-store supaya semakan tidak dilayan oleh HTTP cache yang basi.
    const networkUpdate = fetch(request.url, { cache: 'no-store' }).then(async (res) => {
      if (res && res.ok) {
        if (cached && request.mode === 'navigate') {
          // index.html berubah di network? Kemas kini cache & maklumkan klien —
          // JANGAN ganggu sesi aktif; pengguna pilih bila untuk muat semula.
          const [oldText, newText] = await Promise.all([cached.clone().text(), res.clone().text()]);
          if (oldText !== newText) {
            await cache.put(request.url, res.clone());
            notifyClientsUpdateAvailable();
          }
        } else {
          await cache.put(request.url, res.clone());
        }
      }
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(networkUpdate);
      return cached;
    }
    return (await networkUpdate) || Response.error();
  })());
});
