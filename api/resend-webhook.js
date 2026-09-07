// api/resend-webhook.js
//
// Reverse sync: someone clicks "unsubscribe" inside an email (or an
// integration re-subscribes them), Resend fires a contact.updated webhook,
// and this turns that back into profiles.newsletter_opt_in so the in-app
// toggle in UserSettings.jsx reflects reality without the user having to
// visit the app at all. The forward direction (toggle -> Resend) is
// update-subscriber.js instead.
//
// Modeled on stripe-webhook.js: raw body + signature verification before
// trusting anything in the payload, since this endpoint is publicly
// reachable and a forged request could otherwise flip any account's
// newsletter preference.

import { Webhook } from 'svix';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
    api: {
        bodyParser: false,
    },
};

const getRawBody = (req) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    if (!process.env.RESEND_WEBHOOK_SECRET) {
        console.error('RESEND_WEBHOOK_SECRET is not set -- refusing to trust an unverifiable webhook.');
        return res.status(500).json({ error: 'Webhook not configured' });
    }

    const payload = await getRawBody(req);

    let event;
    try {
        const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
        event = wh.verify(payload, {
            'svix-id': req.headers['svix-id'],
            'svix-timestamp': req.headers['svix-timestamp'],
            'svix-signature': req.headers['svix-signature'],
        });
    } catch (err) {
        console.error(`Resend webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'contact.updated' || event.type === 'contact.created') {
        const contact = event.data || {};
        const email = contact.email;
        const unsubscribed = !!contact.unsubscribed;

        if (email) {
            const { error } = await supabase
                .from('profiles')
                .update({ newsletter_opt_in: !unsubscribed })
                .eq('email', email);

            if (error) {
                console.error('Error syncing Resend contact to profiles:', error);
                return res.status(500).json({ error: 'Database update failed' });
            }
        } else {
            console.error('Resend contact event had no email address.');
        }
    }

    res.json({ received: true });
}
