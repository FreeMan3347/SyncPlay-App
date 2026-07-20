// service-worker.js
//
// Minimal service worker — just enough to satisfy PWA installability
// requirements (required for the TWA wrapper) and let the app shell
// load offline. It does NOT cache video files — those are loaded
// locally by the user each time and can be large, so they're
// intentionally left alone here.

const CACHE_NAME = 'syncplay-shell-v3';

const APP_SHELL_FILES = [
  './',
  './index.html',
  './videoController.js',
  './socketClient.js',
  './gestureControls.js',
  './voiceCall.js',
  './subtitleController.js',
  './playerUI.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first: always try to get the latest version while online,
  // and only fall back to the cached copy if the network request fails
  // (i.e. actually offline). The earlier cache-first version could get
  // permanently stuck showing an old deploy even after new files were
  // uploaded, since it never re-checked the network once something was
  // cached — this fixes that.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
