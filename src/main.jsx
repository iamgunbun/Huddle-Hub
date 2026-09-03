import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// CRITICAL FIX FOR CAPACITOR:
// Android WebViews do not have the Notification object globally defined.
// If any third-party package or React component calls "Notification.permission",
// it causes a fatal crash. This safely polyfills it globally before React even loads.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('Service Worker registered successfully:', registration.scope);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    });
}

if (typeof window !== 'undefined' && !window.Notification) {
    window.Notification = {
        permission: 'denied',
        requestPermission: () => Promise.resolve('denied'),
    };
}

// ==========================================
// GLOBAL SLEEPER LEAK SHIELD
// ==========================================
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    // Check if any file is trying to fire a Yahoo ID at the Sleeper API
    if (url && url.includes('api.sleeper.app/v1/league/')) {
        const idMatch = url.match(/league\/([^\/]+)/);
        const leagueId = idMatch ? idMatch[1] : '';

        // If the ID has a dot or non-numeric characters (Yahoo format), kill the request
        if (leagueId.includes('.') || !/^\d+$/.test(leagueId)) {
            // Silently return a valid empty JSON response so components don't crash
            return new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    return originalFetch(...args);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)