// Tumana Service Worker — offline-first PWA
// Upload this file to: kwachdavid123-beep.github.io/Tumana/sw.js

var CACHE_NAME = 'tumana-v3';
var SHELL_URL = '/Tumana/tumana.html';

// On install — cache the app shell
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll([
        SHELL_URL,
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
      ]).catch(function(e){ console.log('Cache partial:', e); });
    })
  );
});

// On activate — clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// Fetch strategy:
// App shell → cache-first (always loads offline)
// Firebase/Firestore → network-only (handled by Firestore SDK offline)
// Tiles (OpenStreetMap) → cache-first with network fallback
// Everything else → network-first with cache fallback
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Never intercept Firebase — Firestore SDK handles offline itself
  if (url.includes('googleapis.com') ||
      url.includes('firebaseio.com') ||
      url.includes('firestore.googleapis.com') ||
      url.includes('gstatic.com')) {
    return;
  }

  // App shell — cache first, always available offline
  if (url.includes('/Tumana/tumana.html') || url === self.location.origin + '/Tumana/') {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        // Serve cached, update in background
        var fetchPromise = fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(event.request, clone); });
          }
          return response;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Map tiles — cache first for offline maps
  if (url.includes('tile.openstreetmap.org') || url.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(event.request, clone); });
          }
          return response;
        }).catch(function() { return new Response('', {status: 503}); });
      })
    );
    return;
  }

  // Nominatim reverse geocode — network with silent fail
  if (url.includes('nominatim.openstreetmap.org')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({address:{village:'Offline'}}),
          {headers:{'Content-Type':'application/json'}});
      })
    );
    return;
  }

  // Default — network first, fallback to cache, fallback to app shell
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request).then(function(cached) {
        return cached || caches.match(SHELL_URL);
      });
    })
  );
});
