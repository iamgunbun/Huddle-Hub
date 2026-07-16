// public/sw.js

self.addEventListener('push', function(event) {
    // Parse the payload sent from your backend
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Huddle FF';
    
    const options = {
        body: data.body || 'New league activity!',
        icon: '/logo.png', // The large icon next to the text
        badge: '/logo.png', // The tiny monochrome icon in the top status bar
        data: data.url || '/', // URL to open when tapped
        vibrate: [200, 100, 200]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Listen for the user tapping the notification
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // Open the app to the specific URL sent in the payload
    event.waitUntil(
        clients.openWindow(event.notification.data)
    );
});