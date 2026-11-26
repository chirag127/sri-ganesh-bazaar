// Dedicated push scope; never cache account pages or notification payloads.
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('Shop update', {
    body: 'Open the app to view an update.', tag: 'shop-update', data: { path: '/app/' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/app/'));
});
