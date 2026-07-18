import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// CRITICAL FIX FOR CAPACITOR:
// Android WebViews do not have the Notification object globally defined.
// If any third-party package or React component calls "Notification.permission",
// it causes a fatal crash. This safely polyfills it globally before React even loads.
if (typeof window !== 'undefined' && !window.Notification) {
    window.Notification = {
        permission: 'denied',
        requestPermission: () => Promise.resolve('denied'),
    };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)