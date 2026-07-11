// Tumana Service Worker v31
// Strategy:
//   Firebase SDK → cache-first (never changes at fixed version URLs)
//   App HTML     → network-first (always get latest)
//   Static assets → cache-first (images, manifest)

const CACHE_APP    = 'tumana-app-v31';
const CACHE_VENDOR = 'tumana-vendor-v1'; // Firebase SDK — long-lived

// Firebase SDK files at fixed version — safe to cache forever
const FIREBASE_SDK = [
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-functions-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js',
];

// App static assets
const STATIC_ASSETS = [
  '/Tumana/tumana-logo.png',
  '/Tumana/tumana-logo-192.png',
  '/Tumana/tumana-splash.png',
  '/Tumana/manifest.json',
];

// Install: pre-cache Firebase SDK + static assets
self.addEventListener('install', function(e){
  e.waitUntil(
    Promise.all([
      // Cache Firebase SDK (vendor cache — very long-lived)
      caches.open(CACHE_VENDOR).then(function(cache){
        return cache.addAll(FIREBASE_SDK).catch(function(err){
          console.log('Vendor cache partial fail (offline?):', err.message);
        });
      }),
      // Cache static assets
      caches.open(CACHE_APP).then(function(cache){
        return cache.addAll(STATIC_ASSETS).catch(function(){});
      }),
    ])
  );
  self.skipWaiting();
});

// Activate: clean up old caches (but keep vendor cache)
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(key){
        if(key !== CACHE_APP && key !== CACHE_VENDOR){
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Fetch: smart routing
self.addEventListener('fetch', function(e){
  var url = e.request.url;

  // 1. Firebase SDK → cache-first (huge win on 3G: load from disk, not network)
  if(url.includes('gstatic.com/firebasejs')){
    e.respondWith(
      caches.open(CACHE_VENDOR).then(function(cache){
        return cache.match(e.request).then(function(cached){
          if(cached){
            return cached; // From cache — instant, zero network
          }
          // Not cached yet — fetch + cache it
          return fetch(e.request).then(function(response){
            if(response.ok) cache.put(e.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // 2. App HTML (tumana.html) → network-first so users always get updates
  if(url.includes('tumana.html')){
    e.respondWith(
      fetch(e.request).then(function(response){
        if(response.ok){
          caches.open(CACHE_APP).then(function(c){ c.put(e.request, response.clone()); });
        }
        return response;
      }).catch(function(){
        // Offline fallback: serve cached version
        return caches.match(e.request);
      })
    );
    return;
  }

  // 3. Static assets (images, manifest) → cache-first
  if(url.includes('tumana-logo') || url.includes('tumana-splash') || url.includes('manifest.json')){
    e.respondWith(
      caches.match(e.request).then(function(cached){
        return cached || fetch(e.request).then(function(response){
          if(response.ok){
            caches.open(CACHE_APP).then(function(c){ c.put(e.request, response.clone()); });
          }
          return response;
        });
      })
    );
    return;
  }

  // 4. Firebase API calls (Firestore data) → network-only (real-time data)
  if(url.includes('googleapis.com') || url.includes('firebaseio.com')){
    e.respondWith(fetch(e.request).catch(function(){
      return new Response('{"error":"offline"}',{headers:{'Content-Type':'application/json'}});
    }));
    return;
  }

  // 5. Everything else → network with cache fallback
  e.respondWith(
    fetch(e.request).catch(function(){
      return caches.match(e.request);
    })
  );
});

// Push notifications (for future use)
self.addEventListener('push', function(e){
  if(!e.data) return;
  try{
    var d = e.data.json();
    e.waitUntil(
      self.registration.showNotification(d.title||'Tumana', {
        body: d.body||'New update',
        icon: '/Tumana/tumana-logo-192.png',
        badge: '/Tumana/tumana-logo-192.png',
        vibrate: [300,100,300],
        data: d.data||{}
      })
    );
  }catch(err){
    e.waitUntil(
      self.registration.showNotification('Tumana Delivery',{
        body: e.data.text(),
        icon: '/Tumana/tumana-logo-192.png',
      })
    );
  }
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(clients.openWindow('/Tumana/tumana.html'));
});
