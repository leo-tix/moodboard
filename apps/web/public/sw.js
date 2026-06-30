// Minimal service worker — enables PWA install + Web Share Target
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
// fetch handler required for Chrome to recognize this as an installable PWA
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
