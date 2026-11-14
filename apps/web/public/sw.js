/* global self */
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
