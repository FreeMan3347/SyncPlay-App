// service-worker.js
//
// Minimal service worker — just enough to satisfy PWA installability
// requirements (required for the TWA wrapper) and let the app shell
// load offline. It does NOT cache video files — those are loaded
// locally by the user each time and can be large, so they're
// intentionally left alone here.

const CACHE_NAME = 'syncplay-shell-v2';

const APP_SHELL_FILES = [
  './',
  './index.html',
  './videoController.js',
  './socketClient.js',
  './gestureControls.js',
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
  // Cache-first for app shell files, network for everything else
  // (e.g. the Socket.io connection, which isn't a normal fetch anyway).
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
