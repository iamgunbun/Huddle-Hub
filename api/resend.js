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

// Every page in the app actually gated on isPremium as of this writing (grep
// setShowPremiumModal/isPremium across src/pages). Unlimited leagues is real
// too but has no page of its own to link to, so buildProWelcomeEmailHtml
// below gives it a callout line instead of a button.
const PRO_FEATURES = [
    {
        label: 'Trade Analyzer',
        desc: 'AI-graded trade advice before you pull the trigger.',
        href: `${APP_URL}/trade-analyzer`,
    },
    {
        label: 'Draft Analyzer',
        desc: 'Grade your draft class, pick by pick.',
        href: `${APP_URL}/draft-analyzer`,
    },
    {
        label: 'Start/Sit',
        desc: 'Deep-dive verdicts on your toughest lineup calls.',
        href: `${APP_URL}/start-sit`,
    },
    {
        label: 'Managers',
        desc: 'Scouting reports on every manager in your league.',
        href: `${APP_URL}/managers`,
    },
    {
        label: 'Weekly Summary',
        desc: "AI-written recaps of your league's week, every Tuesday.",
        href: `${APP_URL}/weekly-summary`,
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

// Sent once, right after a Stripe checkout completes (see
// api/stripe-webhook.js) or in bulk to every CURRENT Pro subscriber via the
// admin-only backfill below -- a courtesy thank-you plus a direct link into
// every feature Pro actually unlocks, so a new (or already-paying) Pro
// member doesn't have to go hunting for what they're getting.
const buildProWelcomeEmailHtml = () => {
    const featureRows = PRO_FEATURES.map(f => `
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
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;">
            <tr>
                <td style="background: #111318; padding: 28px 32px; text-align: center;">
                    <img src="${APP_URL}/mobile.png" alt="Huddle" width="64" height="64" style="display:block; margin: 0 auto 8px;" />
                    <div style="color: #eebf1c; font-weight: 800; letter-spacing: 1px; font-size: 14px;">HUDDLE FANTASY FOOTBALL</div>
                </td>
            </tr>
            <tr>
                <td style="padding: 32px 32px 8px; text-align: center;">
                    <img src="${APP_URL}/pro-banner.png" alt="Huddle Pro" height="48" style="display:block; margin: 0 auto 16px; object-fit: contain;" />
                    <h1 style="margin: 0 0 8px; font-size: 22px; color: #111;">Thanks for going Pro.</h1>
                    <p style="margin: 0 0 4px; font-size: 15px; color: #444; line-height: 1.5;">
                        Seriously -- Huddle is built by one person, and every subscription is what keeps it going.
                    </p>
                    <p style="margin: 0; font-size: 15px; color: #444; line-height: 1.5;">
                        You're in. Here's everything that just unlocked:
                    </p>
                </td>
            </tr>
            <tr>
                <td style="padding: 24px 32px 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        ${featureRows}
                    </table>
                </td>
            </tr>
            <tr>
                <td style="padding: 8px 32px 32px;">
                    <div style="background: #f7f7f8; border-radius: 8px; padding: 14px 16px; text-align: center;">
                        <span style="font-size: 13px; color: #444;">Plus, your league cap is gone -- connect as many leagues as you actually play in.</span>
                    </div>
                    <div style="text-align: center; margin-top: 24px;">
                        <a href="${APP_URL}/" style="display: inline-block; padding: 12px 28px; background: #111318; color: #eebf1c; text-decoration: none; font-weight: 700; font-size: 14px; border-radius: 8px;">Go to your league hub</a>
                    </div>
                </td>
            </tr>
            <tr>
                <td style="padding: 20px 32px; background: #f7f7f8; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #888;">
                        You're getting this because you just subscribed to Huddle Pro.
                        Manage your subscription anytime in <a href="${APP_URL}/account" style="color: #888;">Account Settings</a>.
                    </p>
                </td>
            </tr>
        </table>
    </div>`;
};

// Bare send, shared by the single-recipient action below and the admin
// backfill's loop -- neither writes to `res` itself, so this is the one
// place that actually talks to Resend's API for this email.
const sendProWelcomeRaw = async (email) => {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: email,
            subject: 'Thanks for going Pro.',
            html: buildProWelcomeEmailHtml(),
        }),
    });

    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        console.error(`Pro welcome email failed for ${email}:`, errBody);
        return { sent: false, reason: 'send_failed' };
    }
    return { sent: true };
};

const sendProWelcomeEmail = async (res, { email }) => {
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Missing email' });
    }
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        console.error('Resend is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL missing).');
        return res.status(200).json({ sent: false, reason: 'not_configured' });
    }

    const result = await sendProWelcomeRaw(email);
    return res.status(200).json(result);
};

// One-time (or occasional) admin broadcast to every CURRENT Pro subscriber,
// triggered from the button in UserSettings.jsx that only renders for the
// app owner's own account. Gated on a real, cryptographically-verified
// Supabase session (the caller's own access token, checked against Supabase
// Auth itself via supabase.auth.getUser) rather than a client-asserted
// email -- this sends real mail to every paying customer, and this
// repository is public, so a client-trusted check here would let anyone who
// reads the source trigger it. `dryRun` returns the recipient count without
// sending anything, so the button can show "send to N subscribers?" before
// committing to the real send.
const PRO_WELCOME_ADMIN_EMAIL = 'ammonsgunner@gmail.com';

const sendProWelcomeBackfill = async (req, res, { dryRun }) => {
    const authHeader = req.headers['authorization'] || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');
    if (!accessToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user || (user.email || '').toLowerCase() !== PRO_WELCOME_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: proProfiles, error: queryError } = await supabase
        .from('profiles')
        .select('email')
        .eq('is_premium', true)
        .not('email', 'is', null);
    if (queryError) {
        console.error('Pro welcome backfill query failed:', queryError);
        return res.status(500).json({ error: queryError.message });
    }

    const emails = [...new Set((proProfiles || []).map(p => p.email).filter(Boolean))];

    // Defaults to a preview -- this sends real mail to every paying
    // customer, so the safe outcome for a missing/malformed dryRun value
    // (a stray API call, a client bug) is "nothing sent" rather than "sent
    // to everyone." Only an explicit `dryRun: false` proceeds to a real send.
    if (dryRun !== false) {
        return res.status(200).json({ dryRun: true, count: emails.length });
    }

    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        console.error('Resend is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL missing).');
        return res.status(200).json({ sent: 0, total: emails.length, reason: 'not_configured' });
    }

    // Sequential, not batched -- this is a rare admin action on what's
    // realistically a small list, and it's one fewer thing that could trip a
    // Resend rate limit compared to firing every send at once.
    let sent = 0;
    const failures = [];
    for (const email of emails) {
        const result = await sendProWelcomeRaw(email);
        if (result.sent) sent++;
        else failures.push(email);
    }

    return res.status(200).json({ total: emails.length, sent, failed: failures.length, failures });
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
        if (action === 'pro-welcome') return await sendProWelcomeEmail(res, body);
        if (action === 'pro-welcome-backfill') return await sendProWelcomeBackfill(req, res, body);

        return res.status(400).json({ error: 'Unknown or missing action' });
    } catch (error) {
        console.error('resend endpoint error:', error);
        // Every action here is a courtesy side effect (a welcome email, a
        // newsletter sync) tied to something that already succeeded
        // elsewhere -- never worth surfacing as a failure to the caller.
        return res.status(200).json({ ok: false, reason: 'error' });
    }
}
