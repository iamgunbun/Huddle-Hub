// src/utils/pushNotifications.js

// Utility to convert your Base64 VAPID key into a format the browser understands
const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
};

export const subscribeToWebPush = async () => {
    // 1. Check if the device/browser actually supports background push
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('Web Push is not supported in this browser.');
        return null;
    }

    try {
        // 2. Register the background worker we created in Step 1
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        // 3. Convert your public key
        const publicVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!publicVapidKey) throw new Error("Missing VITE_VAPID_PUBLIC_KEY in .env");
        
        const convertedVapidKey = urlBase64ToUint8Array(publicVapidKey);

        // 4. Prompt the user for permission and subscribe their device
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedVapidKey
        });

        // This object contains the user's unique device endpoint and keys.
        // You will save this to your database to target them later.
        return subscription;
        
    } catch (error) {
        console.error('Failed to subscribe to Web Push:', error);
        return null;
    }
};