// api/send-push.js
import webPush from 'web-push';

// Configure web-push with your VAPID keys
webPush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VITE_VAPID_PUBLIC_KEY, 
    process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { subscriptions, payload } = req.body;

    if (!subscriptions || !subscriptions.length) {
        return res.status(400).json({ error: 'No subscriptions provided' });
    }

    try {
        // Send the notification to every subscribed user in the array
        const pushPromises = subscriptions.map(sub => {
            return webPush.sendNotification(sub, JSON.stringify(payload))
                .catch(err => {
                    console.error("Push failed for a user. They may have revoked permission.", err);
                    // Optional: You could flag this subscription for deletion in your DB here
                });
        });

        await Promise.all(pushPromises);

        res.status(200).json({ success: true, message: 'Notifications dispatched.' });
    } catch (error) {
        console.error('Error sending push:', error);
        res.status(500).json({ error: 'Failed to send notifications' });
    }
}