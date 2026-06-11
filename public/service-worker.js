const CACHE_NAME = 'uno-arena-cache-v8';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/sounds/deal.wav',
  '/sounds/beep.wav',
  '/sounds/whoosh.wav',
  '/sounds/flip.wav',
  '/sounds/power.wav',
  '/sounds/magic.wav',
  '/sounds/boom.wav',
  '/sounds/uno.wav',
  '/sounds/victory.wav',
  '/sounds/notification.wav',
  '/sounds/draw.wav',
  '/sounds/catch.wav',
  '/sounds/unoAlert.wav'
];

// 1. Install Event: Cache Core Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache and adding static assets');
        // Force network fetch to bypass browser HTTP cache
        const cacheRequests = ASSETS_TO_CACHE.map(url => new Request(url, { cache: 'reload' }));
        return cache.addAll(cacheRequests);
      })
      .then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Network-First for HTML/CSS/JS, Stale-While-Revalidate for images/sounds
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and WebSocket / Socket.io endpoints
  if (event.request.method !== 'GET' || event.request.url.includes('/socket.io/')) {
    return;
  }

  const url = new URL(event.request.url);
  // Check if it's a code/structural asset
  const isCodeAsset = url.pathname === '/' || 
                      url.pathname.endsWith('.html') || 
                      url.pathname.endsWith('.css') || 
                      url.pathname.endsWith('.js') || 
                      url.pathname.endsWith('.json');

  if (isCodeAsset) {
    // Network-First strategy
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline, fall back to cached version (ignore query strings)
          return caches.match(event.request, { ignoreSearch: true });
        })
    );
  } else {
    // Stale-While-Revalidate for static resources (images, sounds, etc.)
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true })
        .then((cachedResponse) => {
          if (cachedResponse) {
            fetch(event.request)
              .then((networkResponse) => {
                if (networkResponse.status === 200) {
                  caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
                }
              })
              .catch(() => {});
            return cachedResponse;
          }
          return fetch(event.request);
        })
    );
  }
});

