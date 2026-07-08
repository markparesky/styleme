// Service worker: network-first with cache fallback for the app shell,
// so the closet opens instantly and works offline. API calls always go
// to the network (sync, scrape, search must be live).
const CACHE = 'styleme-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/manifest.json',
  '/js/app.js', '/js/db.js', '/js/color.js', '/js/garments.js',
  '/js/stylist.js', '/js/weather.js', '/js/demo.js', '/js/sync.js',
  '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;        // CDN (zbar) manages itself
  if (url.pathname.startsWith('/api/')) return;      // live endpoints only
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html')))
  );
});
