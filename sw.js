/**
 * TUMANA Service Worker
 * Handles offline caching and background sync
 */

const CACHE = 'tumana-v13';
const OFFLINE_URL = '/Tumana/tumana.html';
const ASSETS = [
  '/Tumana/tumana.html',
  '/Tumana/tumana-logo.jpg',
  '/Tumana/manifest.json'
];

// Install: cache core files
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS).catch(function() {
        return cache.add(OFFLINE_URL);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate: clean old caches
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

// Fetch: serve from cache, fallback to network
self.addEventListener('fetch', function(e) {
  // Skip non-GET and Firebase/external requests
  if (e.request.method !== 'GET') return;
  var url = e.request.url;
  if (url.indexOf('firestore') >= 0 || url.indexOf('googleapis') >= 0 ||
      url.indexOf('gstatic') >= 0 || url.indexOf('firebase') >= 0) return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        // Cache the main app file on every fresh load
        if (response.ok && url.indexOf('tumana.html') >= 0) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        // Offline: serve cached app
        return caches.match(OFFLINE_URL);
      });
    })
  );
});

// Push notifications (from Firebase Cloud Functions)
self.addEventListener('push', function(e) {
  if (!e.data) return;
  var data = {};
  try { data = e.data.json(); } catch(err) { data = {title:'Tumana', body: e.data.text()}; }

  var title = (data.notification && data.notification.title) || data.title || 'Tumana';
  var body  = (data.notification && data.notification.body)  || data.body  || 'New update';
  var payload = data.data || {};

  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/Tumana/tumana-logo.jpg',
      badge: '/Tumana/tumana-logo.jpg',
      vibrate: [200, 100, 200],
      data: payload,
      tag: payload.order_id || 'tumana-' + Date.now(),
      renotify: true,
      actions: payload.type === 'new_job' ? [
        { action: 'view', title: 'View Job' }
      ] : [
        { action: 'open', title: 'Open App' }
      ]
    })
  );
});

// Notification click: open app
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
