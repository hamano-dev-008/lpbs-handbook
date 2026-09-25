// Service worker — PWA installability + app-shell caching + update notification.
// Naikkan APP_VERSION serentak dengan APP_VERSION dalam index.html setiap deploy;
// nama cache berversi memastikan cache lama dibuang bersih semasa activate.
// Data Google API (Calendar/Sheets) TIDAK dicache — sentiasa live dari network.

const APP_VERSION = '1.0.35';
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

  // Navigasi (index.html): network-first, sandaran cache jika network gagal atau
  // lambat (>4s). Guna URL (bukan Request mod 'navigate' — Cache.put menolaknya)
  // dan no-store supaya tidak dilayan oleh HTTP cache yang basi.
  if (request.mode === 'navigate') {
    const network = fetch(request.url, { cache: 'no-store' });
    // Klon segera (sebelum halaman membaca body) & simpan untuk sandaran luar talian,
    // termasuk jika network hanya selesai selepas tamat masa 4s.
    event.waitUntil(network.then((res) => {
      if (!res.ok) return;
      const copy = res.clone();
      return caches.open(CACHE_NAME).then((cache) => cache.put(request.url, copy));
    }).catch(() => {}));

    event.respondWith((async () => {
      const timeout = new Promise((resolve) => setTimeout(resolve, 4000, null));
      const res = await Promise.race([network, timeout]).catch(() => null);
      if (res && res.ok) return res;
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      // Tiada cache (lawatan pertama): tunggu network — gagal secara semula jadi jika luar talian.
      return res || network;
    })());
    return;
  }

  // manifest.json & ikon: cache-first (paparan segera), semak network di latar belakang.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: false });

    const networkUpdate = fetch(request.url, { cache: 'no-store' }).then(async (res) => {
      if (res && res.ok) {
        await cache.put(request.url, res.clone());
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

// Push notifications (FCM) — payload dijangka { title, body, url } (data-only,
// bukan payload "notification" bawaan FCM, supaya paparan dikawal sepenuhnya di sini).
self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const d = payload.data || payload;
  event.waitUntil(
    self.registration.showNotification(d.title || 'PadiApp', {
      body: d.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: d.url || self.registration.scope }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url || self.registration.scope;
  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window' });
    for (const client of windowClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    await clients.openWindow(url);
  })());
});
