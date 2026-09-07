// api/resend.js
//
// Every Resend-related endpoint lives in this one file. Vercel's Hobby plan
// caps a deployment at 12 Serverless Functions (one per file in api/), and
// this app was already at 11 -- four separate files for welcome email,
// enroll, update, and the incoming webhook would have pushed it to 15 and
// failed every deploy (errorCode: exceeded_serverless_functions_per_deployment).
// One file, dispatched by an `action` field for our own frontend's calls, an
// external Resend webhook, or a real error -- happens.
//
// Frontend calls POST here with a JSON body: { action: 'welcome' | 'enroll' | 'update', ... }.
// Resend's own webhook deliveries are recognised instead by the svix-* headers
// it always signs requests with, since a webhook body isn't in our own shape.
//
// bodyParser is off so the webhook path can verify the exact raw bytes Resend
// signed; the frontend-action path parses that same raw body as JSON itself.

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

const APP_URL = 'https://huddleff.app';

const FEATURES = [
    {
        label: 'Trophy Room',
        desc: "See your league's champions, records, and rivalries.",
        href: `${APP_URL}/awards`,
    },
    {
        label: 'Rosters & Matchups',
        desc: 'Live scoring, projections, and weekly lineups.',
        href: `${APP_URL}/rosters`,
    },
    {
        label: 'Trade Grader & Start/Sit',
        desc: 'AI-assisted advice before you make a move.',
        href: `${APP_URL}/trade-analyzer`,
    },
    {
        label: 'Power Rankings & Projections',
        desc: "Playoff and championship odds for every team.",
        href: `${APP_URL}/projections`,
    },
];

const escapeHtml = (str) => String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildWelcomeEmailHtml = (leagueName) => {
    const safeName = escapeHtml(leagueName);
    const featureRows = FEATURES.map(f => `
        <tr>
            <td style="padding: 14px 0; border-bottom: 1px solid #eee;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td>
                            <div style="font-weight: 700; font-size: 15px; color: #111;">${escapeHtml(f.label)}</div>
                            <div style="font-size: 13px; color: #666; margin-top: 2px;">${escapeHtml(f.desc)}</div>
                        </td>
                        <td align="right" style="white-space: nowrap;">
                            <a href="${f.href}" style="display: inline-block; padding: 8px 16px; background: #eebf1c; color: #111; text-decoration: none; font-weight: 700; font-size: 13px; border-radius: 6px;">Open</a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    `).join('');

    return `
    <div style="background:#0b0f16; padding: 32px 16px; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;">
            <tr>
                <td style="background: #111318; padding: 28px 32px; text-align: center;">
                    <img src="${APP_URL}/brand.png" alt="Huddle" width="64" height="64" style="display:block; margin: 0 auto 8px;" />
                    <div style="color: #eebf1c; font-weight: 800; letter-spacing: 1px; font-size: 14px;">HUDDLE FANTASY FOOTBALL</div>
                </td>
            </tr>
            <tr>
                <td style="padding: 32px;">
                    <h1 style="margin: 0 0 8px; font-size: 22px; color: #111;">Welcome to Huddle, ${safeName}!</h1>
                    <p style="margin: 0 0 24px; font-size: 15px; color: #444; line-height: 1.5;">
                        Your league is connected. Here's what's waiting for you:
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        ${featureRows}
                    </table>
                    <div style="text-align: center; margin-top: 28px;">
                        <a href="${APP_URL}/" style="display: inline-block; padding: 12px 28px; background: #111318; color: #eebf1c; text-decoration: none; font-weight: 700; font-size: 14px; border-radius: 8px;">Go to your league hub</a>
                    </div>
                </td>
            </tr>
            <tr>
                <td style="padding: 20px 32px; background: #f7f7f8; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #888;">
                        You're getting this because you just connected ${safeName} on Huddle.
                        Manage your email preferences anytime in <a href="${APP_URL}/account" style="color: #888;">Account Settings</a>.
                    </p>
                </td>
            </tr>
        </table>
    </div>`;
};

const sendWelcomeEmail = async (res, { email, leagueName }) => {
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Missing email' });
    }

    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        console.error('Resend is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL missing).');
        // A missing integration is our problem, not the connecting user's --
        // fail quietly (200) so a misconfigured mail provider never blocks
        // someone from finishing connecting their league.
        return res.status(200).json({ sent: false, reason: 'not_configured' });
    }

    const safeLeagueName = leagueName && typeof leagueName === 'string' ? leagueName : 'your league';

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: email,
            subject: `Welcome to ${safeLeagueName} on Huddle!`,
            html: buildWelcomeEmailHtml(safeLeagueName),
        }),
    });

    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        console.error('Resend welcome email failed:', errBody);
        return res.status(200).json({ sent: false, reason: 'send_failed' });
    }

    return res.status(200).json({ sent: true });
};

const enrollSubscriber = async (res, { email }) => {
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Missing email' });
    }

    if (!process.env.RESEND_API_KEY || !process.env.RESEND_AUDIENCE_ID) {
        console.error('Resend is not configured (RESEND_API_KEY / RESEND_AUDIENCE_ID missing).');
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
};

const updateSubscriber = async (res, { email, unsubscribed }) => {
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
};

// Reverse sync: someone clicks "unsubscribe" inside an email (or an
// integration re-subscribes them), Resend fires a contact.updated webhook,
// and this turns that back into profiles.newsletter_opt_in so the in-app
// toggle reflects reality without the user having to visit the app at all.
//
// Verified via svix before anything in the payload is trusted -- this
// endpoint is publicly reachable, and a forged request could otherwise flip
// any account's newsletter preference.
const handleWebhook = async (req, res, rawBody) => {
    if (!process.env.RESEND_WEBHOOK_SECRET) {
        console.error('RESEND_WEBHOOK_SECRET is not set -- refusing to trust an unverifiable webhook.');
        return res.status(500).json({ error: 'Webhook not configured' });
    }

    let event;
    try {
        const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
        event = wh.verify(rawBody, {
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

    return res.json({ received: true });
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const rawBody = await getRawBody(req);

    // Resend signs every webhook delivery with these headers; nothing our own
    // frontend sends carries them, so their presence is what tells the two
    // request shapes apart.
    if (req.headers['svix-id'] && req.headers['svix-signature']) {
        return handleWebhook(req, res, rawBody);
    }

    try {
        const body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        const { action } = body;

        if (action === 'welcome') return await sendWelcomeEmail(res, body);
        if (action === 'enroll') return await enrollSubscriber(res, body);
        if (action === 'update') return await updateSubscriber(res, body);

        return res.status(400).json({ error: 'Unknown or missing action' });
    } catch (error) {
        console.error('resend endpoint error:', error);
        // Every action here is a courtesy side effect (a welcome email, a
        // newsletter sync) tied to something that already succeeded
        // elsewhere -- never worth surfacing as a failure to the caller.
        return res.status(200).json({ ok: false, reason: 'error' });
    }
}
