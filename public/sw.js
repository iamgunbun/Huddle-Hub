// public/sw.js

self.addEventListener('push', function(event) {
    if (event.data) {
        const data = event.data.json();
        
        const options = {
            body: data.body || 'New message in league chat!',
            icon: '/brand.png', // Ensure this points to your logo
            badge: '/brand.png',
            vibrate: [100, 50, 100],
            data: {
                url: data.url || '/'
            }
        };

        // This is what actually forces the phone to show the banner
        event.waitUntil(
            self.registration.showNotification(data.title || 'Huddle FF', options)
        );
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // When they tap the banner, open the app to the correct league
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                let client = windowClients[i];
                if (client.url === '/' && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});

// REQUIRED BY CHROME FOR PWA INSTALLATION
// Even if empty, a fetch listener tells the browser this is a legitimate, installable app.
self.addEventListener('fetch', function(event) {
    // We are just letting the network handle the request normally
    return;
});