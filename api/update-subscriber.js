// api/update-subscriber.js
//
// Forward sync: called when someone flips the newsletter toggle in
// UserSettings.jsx, so Resend's own subscribed/unsubscribed state matches
// what the app just recorded in profiles.newsletter_opt_in. The reverse
// direction (an unsubscribe click inside an email) is handled by
// resend-webhook.js instead -- that one updates Supabase from Resend, not
// the other way around.

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { email, unsubscribed } = req.body || {};

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Missing email' });
        }

        if (!process.env.RESEND_API_KEY || !process.env.RESEND_AUDIENCE_ID) {
            console.error('Resend is not configured (RESEND_API_KEY / RESEND_AUDIENCE_ID missing).');
            return res.status(200).json({ updated: false, reason: 'not_configured' });
        }

        const headers = {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        };
        const contactUrl = `https://api.resend.com/audiences/${process.env.RESEND_AUDIENCE_ID}/contacts/${encodeURIComponent(email)}`;

        const patchResponse = await fetch(contactUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ unsubscribed: !!unsubscribed }),
        });

        if (patchResponse.ok) {
            return res.status(200).json({ updated: true });
        }

        // Resend only has this contact once they've been enrolled once (e.g.
        // signup pre-dates this feature, or they'd opted out at signup and are
        // opting in now) -- a 404 here means "create them" rather than a real
        // failure.
        if (patchResponse.status === 404) {
            const createResponse = await fetch(`https://api.resend.com/audiences/${process.env.RESEND_AUDIENCE_ID}/contacts`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ email, unsubscribed: !!unsubscribed }),
            });

            if (!createResponse.ok) {
                const errBody = await createResponse.json().catch(() => ({}));
                console.error('Resend contact create (via update) failed:', errBody);
                return res.status(200).json({ updated: false, reason: 'send_failed' });
            }

            return res.status(200).json({ updated: true });
        }

        const errBody = await patchResponse.json().catch(() => ({}));
        console.error('Resend contact update failed:', errBody);
        return res.status(200).json({ updated: false, reason: 'send_failed' });
    } catch (error) {
        console.error('update-subscriber error:', error);
        return res.status(200).json({ updated: false, reason: 'error' });
    }
}
