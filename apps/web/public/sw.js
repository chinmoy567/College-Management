/* global self, caches, fetch, URL */
// Push handler (07 §6). The payload is a title, a short generic text and a URL; never message or post content.
self.addEventListener('push', (event) => {
  let d = { title: 'College', body: 'You have a new notification.', url: '/notifications' };
  try { d = { ...d, ...event.data.json() }; } catch { /* keep the default */ }
  event.waitUntil(self.registration.showNotification(d.title, { body: d.body, data: { url: d.url } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/notifications';
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    for (const c of cs) if ('focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

// Offline shell (FE-09). Only static assets are cached; /api/*, sockets and every other request go to the network
// untouched, so no personal data is ever stored by the service worker.
const SHELL = 'cms-shell-v1';
const SHELL_URLS = ['/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return; // never cached
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  if (SHELL_URLS.includes(url.pathname)) event.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
