// api/send-league-welcome-email.js
//
// Fired once per successful league connection (see AddLeague.jsx), not
// gated on newsletter_opt_in -- this is a transactional email tied directly
// to an action the account just took, the same way Stripe's receipt emails
// aren't a marketing preference. The recurring newsletter is the thing
// newsletter_opt_in governs (see enroll-subscriber.js / update-subscriber.js).

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

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { email, leagueName } = req.body || {};

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
    } catch (error) {
        console.error('send-league-welcome-email error:', error);
        // Same reasoning as above: this is a courtesy email, never worth
        // surfacing as a failure on the league-connect flow itself.
        return res.status(200).json({ sent: false, reason: 'error' });
    }
}
