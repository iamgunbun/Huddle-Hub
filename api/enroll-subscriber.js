// api/enroll-subscriber.js
//
// Adds a contact to the app's Resend Audience so the recurring newsletter
// (distinct from the transactional welcome email, see
// send-league-welcome-email.js) actually reaches them. Called fire-and-forget
// from Login.jsx right after signup when the newsletter checkbox is checked.

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { email } = req.body || {};

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Missing email' });
        }

        if (!process.env.RESEND_API_KEY || !process.env.RESEND_AUDIENCE_ID) {
            console.error('Resend is not configured (RESEND_API_KEY / RESEND_AUDIENCE_ID missing).');
            // Newsletter enrollment is a side effect of signup, never a reason
            // to fail it -- same reasoning as the welcome email's fail-soft path.
            return res.status(200).json({ enrolled: false, reason: 'not_configured' });
        }

        const response = await fetch(`https://api.resend.com/audiences/${process.env.RESEND_AUDIENCE_ID}/contacts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, unsubscribed: false }),
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            console.error('Resend contact enrollment failed:', errBody);
            return res.status(200).json({ enrolled: false, reason: 'send_failed' });
        }

        return res.status(200).json({ enrolled: true });
    } catch (error) {
        console.error('enroll-subscriber error:', error);
        return res.status(200).json({ enrolled: false, reason: 'error' });
    }
}
