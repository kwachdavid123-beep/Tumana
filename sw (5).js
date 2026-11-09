// Tumana Service Worker v3 — true offline PWA
// Upload to: kwachdavid123-beep.github.io/Tumana/sw.js
// After first online load, the app works completely offline.

var CACHE = 'tumana-v101';

// Everything needed to boot the app offline
var PRECACHE = [
  '/Tumana/tumana.html',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js'
];

// ── Install: pre-cache the app shell + Firebase SDK ──────────────────
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(function(cache) {
      // Cache each item individually — partial failure doesn't break install
      return Promise.all(
        PRECACHE.map(function(url) {
          return cache.add(url).catch(function(e) {
            console.log('Failed to pre-cache:', url, e);
          });
        })
      );
    })
  );
});

// ── Activate: remove old caches ───────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ── Fetch: serve cached resources offline ─────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  var method = event.request.method;

  // Only handle GET requests
  if (method !== 'GET') return;

  // Never intercept Firestore data requests — the Firestore SDK manages
  // its own offline cache via IndexedDB (enablePersistence)
  if (url.includes('router.project-osrm.org') ||
      url.includes('firestore.googleapis.com') ||
      url.includes('firebaseio.com') ||
      url.includes('identitytoolkit.googleapis.com')) {
    return;
  }

  // App shell + Firebase SDK — cache first, update in background
  // These are versioned so cache-first is safe
  if (url.includes('/Tumana/tumana.html') ||
      url.includes('gstatic.com/firebasejs')) {
    event.respondWith(
      caches.open(CACHE).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          // Serve cache immediately, refresh in background
          var networkFetch = fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(function() { return null; });
          // Return cached immediately if available, else wait for network
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // OpenStreetMap tiles — cache as user browses (offline map works after visiting)
  if (url.includes('tile.openstreetmap.org') || url.includes('basemaps.cartocdn.com') || url.includes('tile.openstreetmap.fr')) {
    event.respondWith(
      caches.open(CACHE).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          if (cached) return cached;
          return fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(function() {
            return new Response('', { status: 503, statusText: 'Offline' });
          });
        });
      })
    );
    return;
  }

  // Nominatim geocoding — silent offline fallback
  if (url.includes('nominatim.openstreetmap.org')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(
          JSON.stringify({ address: { village: 'Chemelil', county: 'Kisumu' } }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Everything else — network first, fall back to cache, fall back to app shell
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request).then(function(cached) {
        return cached || caches.match('/Tumana/tumana.html');
      });
    })
  );
});
