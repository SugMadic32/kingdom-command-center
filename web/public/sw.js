// Service worker for browser push notifications
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Kingdom Command Center' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Kingdom Command Center', {
    body: data.body || '', icon: '/favicon.svg', data: { link: data.link || '/' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.link || '/'));
});
