/**
 * TUMANA Service Worker - v16
 * Strategy:
 *  - tumana.html: NETWORK-FIRST (always get latest code when online,
 *    fall back to cache only when offline). This prevents the app
 *    getting stuck on an old cached version after updates.
 *  - Static assets (logo, manifest): CACHE-FIRST (rarely change).
 *  - Firebase/Google requests: never intercepted, always pass through.
 */

const CACHE = 'tumana-v18';
const APP_URL = '/Tumana/tumana.html';
const STATIC_ASSETS = [
  '/Tumana/tumana-logo.png',
  '/Tumana/tumana-logo-192.png',
  '/Tumana/tumana-splash.png',
  '/Tumana/manifest.json'
];

// Install: pre-cache the app shell + static assets
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll([APP_URL].concat(STATIC_ASSETS)).catch(function() {
        // If some assets 404 (not yet uploaded), still cache what we can
        return cache.add(APP_URL).catch(function(){});
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate: remove old cache versions
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch strategy
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url;

  // Never intercept Firebase / Google API calls
  if (url.indexOf('firestore') >= 0 || url.indexOf('googleapis') >= 0 ||
      url.indexOf('gstatic') >= 0 || url.indexOf('firebase') >= 0 ||
      url.indexOf('google.com') >= 0) {
    return;
  }

  // Main app file: NETWORK-FIRST so updates always show when online
  if (url.indexOf('tumana.html') >= 0 || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function(response) {
        if (response && response.ok) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(APP_URL, clone); });
        }
        return response;
      }).catch(function() {
        // Offline: serve last cached version
        return caches.match(APP_URL).then(function(cached) {
          return cached || new Response(
            '<h2 style="font-family:sans-serif;text-align:center;margin-top:80px;color:#666">You are offline and no cached version is available yet.<br>Connect to the internet once to load Tumana.</h2>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        });
      })
    );
    return;
  }

  // Static assets: CACHE-FIRST
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (response && response.ok) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        return cached; // undefined if nothing cached, browser shows its own error
      });
    })
  );
});

// ── PUSH NOTIFICATIONS (from Firebase Cloud Functions) ──────────────
self.addEventListener('push', function(e) {
  if (!e.data) return;
  var data = {};
  try { data = e.data.json(); } catch(err) { data = { notification: { title: 'Tumana', body: e.data.text() } }; }

  var title = (data.notification && data.notification.title) || data.title || 'Tumana';
  var body  = (data.notification && data.notification.body)  || data.body  || 'New update';
  var payload = data.data || {};

  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/Tumana/tumana-logo-192.png',
      badge: '/Tumana/tumana-logo-192.png',
      vibrate: [200, 100, 200],
      data: payload,
      tag: payload.order_id || ('tumana-' + Date.now()),
      renotify: true,
      actions: payload.type === 'new_job' ? [{ action: 'view', title: 'View Job' }] : [{ action: 'open', title: 'Open App' }]
    })
  );
});

// Notification click: focus or open the app
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      return clients.openWindow('/Tumana/tumana.html');
    })
  );
});
