// Tumana Service Worker v2 - FIXED
// Only caches Tumana files, never intercepts CHAWKPRO
const CACHE = 'tumana-v2';

const TUMANA_FILES = [
  '/Chawkpro/tumana.html',
  '/Chawkpro/manifest.json',
  '/Chawkpro/tumana-logo.png'
];

// Install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(TUMANA_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate - remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - CRITICAL: only handle tumana.html, let everything else pass through
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // NEVER intercept CHAWKPRO or index.html requests
  if (url.includes('chawkpro.html') ||
      url.includes('index.html') ||
      url.includes('firebase') ||
      url.includes('googleapis') ||
      url.includes('gstatic') ||
      e.request.method !== 'GET') {
    return; // Pass through - don't intercept
  }

  // Only cache tumana.html
  if (url.includes('tumana.html')) {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/Chawkpro/tumana.html'))
    );
  }
});
