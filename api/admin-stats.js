// api/admin-stats.js
//
// Weekly owner's report: signups, memberships bought, and revenue, emailed to
// one hardcoded address. Runs from the Vercel cron in vercel.json.
//
// WHY REVENUE COMES FROM STRIPE AND NOT FROM OUR OWN DATABASE
// -----------------------------------------------------------
// api/stripe-webhook.js records exactly one thing about a purchase: it flips
// profiles.is_premium to true. No amount, no currency, no timestamp, no row
// per payment. So the database can answer "how many Pro members are there
// right now" but genuinely cannot answer "how much did we make last week" or
// "how many memberships were bought last week" -- is_premium has no history,
// and a member who churned and resubscribed looks identical to one who never
// left.
//
// Rather than start recording payments now (which would report $0 until new
// purchases accumulated, and would quietly disagree with Stripe forever
// after), this reads Stripe directly. Stripe is the system of record for
// money: it already knows every charge, refund and checkout session since
// launch, so the first email is correct and the numbers always reconcile
// with the Stripe dashboard.
//
// Signups come from Supabase auth, which does have a real created_at.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Not a request parameter, deliberately. This report carries revenue; if the
// recipient were caller-supplied, anyone who ever learned the cron secret
// could redirect the business's finances to themselves.
const REPORT_TO = 'ammonsgunner@gmail.com';

const APP_URL = 'https://huddleff.app';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Stripe reports amounts in the smallest unit of the currency, which is NOT
// always 1/100. Dividing everything by 100 would report a ¥5,000 sale as
// ¥50. These are the currencies Stripe treats as having no decimal part.
const ZERO_DECIMAL = new Set([
    'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
    'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

export const minorToMajor = (amount, currency) =>
    ZERO_DECIMAL.has(String(currency || '').toLowerCase()) ? amount : amount / 100;

export const formatMoney = (amount, currency) => {
    const code = String(currency || 'usd').toUpperCase();
    const value = minorToMajor(amount, currency);
    const digits = ZERO_DECIMAL.has(code.toLowerCase()) ? 0 : 2;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency', currency: code,
            minimumFractionDigits: digits, maximumFractionDigits: digits,
        }).format(value);
    } catch {
        // An unknown/custom currency code must not take the whole report down.
        return `${value.toFixed(digits)} ${code}`;
    }
};

/**
 * The seven days ending at `now`, plus the seven before that for comparison.
 * Returned as seconds too, since Stripe filters on unix seconds while
 * Supabase/JS work in milliseconds.
 */
export const reportWindow = (now = new Date()) => {
    const end = now instanceof Date ? now.getTime() : Number(now);
    const start = end - WEEK_MS;
    const prevStart = start - WEEK_MS;
    return {
        start, end, prevStart, prevEnd: start,
        startSec: Math.floor(start / 1000),
        endSec: Math.floor(end / 1000),
        prevStartSec: Math.floor(prevStart / 1000),
    };
};

/**
 * Totals a list of Stripe charges, grouped by currency.
 *
 * Only charges that actually succeeded count, and refunds are subtracted
 * rather than ignored -- a week with a £20 sale and a £20 refund made no
 * money, and reporting it as £20 would be a lie the owner acts on.
 */
export const summarizeCharges = (charges) => {
    const byCurrency = {};
    let paidCount = 0;
    let refundedCount = 0;

    (charges || []).forEach(ch => {
        if (!ch || ch.status !== 'succeeded' || !ch.paid) return;
        const currency = String(ch.currency || 'usd').toLowerCase();
        const gross = Number(ch.amount) || 0;
        const refunded = Number(ch.amount_refunded) || 0;

        if (!byCurrency[currency]) byCurrency[currency] = { gross: 0, refunded: 0, net: 0, count: 0 };
        byCurrency[currency].gross += gross;
        byCurrency[currency].refunded += refunded;
        byCurrency[currency].net += gross - refunded;
        byCurrency[currency].count += 1;

        paidCount += 1;
        if (refunded > 0) refundedCount += 1;
    });

    return { byCurrency, paidCount, refundedCount };
};

/** How many of these records were created inside [start, end). */
export const countCreatedWithin = (records, start, end, field = 'created_at') => {
    return (records || []).reduce((n, r) => {
        const raw = r?.[field];
        if (!raw) return n;
        const t = typeof raw === 'number' ? raw : Date.parse(raw);
        if (!Number.isFinite(t)) return n;
        return (t >= start && t < end) ? n + 1 : n;
    }, 0);
};

/**
 * A week-over-week change, as a string that is honest about the zero case.
 * "+3" and "-2" are useful; "+300%" off a base of one signup is not, and
 * "+0%" when last week was also zero is meaningless.
 */
export const deltaLabel = (current, previous) => {
    const diff = (Number(current) || 0) - (Number(previous) || 0);
    if (diff === 0) return 'no change vs last week';
    return `${diff > 0 ? '+' : ''}${diff} vs last week`;
};

// Supabase's admin API pages users; there is no "count created since" filter,
// so the only honest way to count a week's signups is to walk the list. The
// cap stops a runaway loop from burning the whole function budget if the
// user base ever gets large enough that this needs a real created_at column
// on profiles instead.
const MAX_USER_PAGES = 25;
const USERS_PER_PAGE = 1000;

const listAllUsers = async () => {
    const users = [];
    let truncated = false;
    for (let page = 1; page <= MAX_USER_PAGES; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
        if (error) throw error;
        const batch = data?.users || [];
        users.push(...batch);
        if (batch.length < USERS_PER_PAGE) return { users, truncated };
        if (page === MAX_USER_PAGES) truncated = true;
    }
    return { users, truncated };
};

const esc = (str) => String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const statTile = (label, value, sub) => `
    <td style="padding: 0 6px;" width="33%">
      <div style="background:#141b26; border:1px solid rgba(238,191,28,0.18); border-radius:10px; padding:16px 14px; text-align:center;">
        <div style="color:#64748b; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">${esc(label)}</div>
        <div style="color:#eebf1c; font-size:30px; font-weight:800; margin-top:6px; line-height:1;">${esc(value)}</div>
        <div style="color:#8b99ab; font-size:11px; margin-top:6px;">${esc(sub)}</div>
      </div>
    </td>`;

export const buildAdminStatsEmailHtml = (stats) => {
    const {
        rangeLabel, signups, signupsDelta, memberships, membershipsDelta,
        revenueLines, totalUsers, totalPro, notes,
    } = stats;

    const revenueBlock = revenueLines.length
        ? revenueLines.map(l => `
            <tr><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08);">
              <div style="color:#f8fafc; font-size:18px; font-weight:800;">${esc(l.net)}</div>
              <div style="color:#8b99ab; font-size:12px; margin-top:3px;">
                ${esc(l.count)} payment${l.count === 1 ? '' : 's'} &middot; gross ${esc(l.gross)}${l.refunded ? ` &middot; refunded ${esc(l.refunded)}` : ''}
              </div>
            </td></tr>`).join('')
        : `<tr><td style="padding: 10px 0; color:#8b99ab; font-size:13px;">No payments in this period.</td></tr>`;

    const noteBlock = notes.length
        ? `<div style="margin-top:22px; padding:12px 14px; background:rgba(238,191,28,0.07); border:1px solid rgba(238,191,28,0.2); border-radius:8px;">
             ${notes.map(n => `<div style="color:#cbd5e1; font-size:12px; line-height:1.5;">${esc(n)}</div>`).join('')}
           </div>`
        : '';

    return `
  <div style="background:#0b0f16; padding:32px 16px; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#0f1620; border-radius:12px; overflow:hidden; border:1px solid rgba(255,255,255,0.06);">
      <tr>
        <td style="background:#111318; padding:26px 32px; text-align:center;">
          <img src="${APP_URL}/mobile.png" alt="Huddle" width="56" height="56" style="display:block; margin:0 auto 8px;" />
          <div style="color:#eebf1c; font-weight:800; letter-spacing:1px; font-size:13px;">WEEKLY BUSINESS REPORT</div>
          <div style="color:#64748b; font-size:12px; margin-top:6px;">${esc(rangeLabel)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 26px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${statTile('New signups', String(signups), signupsDelta)}
            ${statTile('Memberships', String(memberships), membershipsDelta)}
            ${statTile('Pro members', String(totalPro), `${totalUsers} total users`)}
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 32px 28px;">
          <div style="color:#eebf1c; font-size:12px; font-weight:700; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px;">Revenue this week</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${revenueBlock}</table>
          ${noteBlock}
          <div style="color:#5a6778; font-size:11px; line-height:1.5; margin-top:22px;">
            Revenue and membership counts come from Stripe; signups and member totals from the app database.
            Net is gross minus refunds for the period.
          </div>
        </td>
      </tr>
    </table>
  </div>`;
};

const sendReport = async (subject, html) => {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: REPORT_TO,
            subject,
            html,
        }),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Resend ${response.status}: ${body}`);
    }
    return response.json();
};

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    // Same gate as the weekly summary cron: Vercel attaches this header to
    // its own cron requests when CRON_SECRET is set on the project.
    if (!process.env.CRON_SECRET || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
    const notes = [];

    try {
        const w = reportWindow(new Date());

        // --- Signups (Supabase auth: the only place with a real created_at) ---
        const { users, truncated } = await listAllUsers();
        if (truncated) {
            notes.push(`Only the first ${MAX_USER_PAGES * USERS_PER_PAGE} users were scanned, so signup counts may be low.`);
        }
        const signups = countCreatedWithin(users, w.start, w.end);
        const prevSignups = countCreatedWithin(users, w.prevStart, w.prevEnd);

        // --- Current membership totals (a snapshot, not a period count) ---
        const { count: totalPro, error: proErr } = await supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('is_premium', true);
        if (proErr) throw proErr;

        // --- Money + memberships bought (Stripe is the system of record) ---
        let memberships = 0, prevMemberships = 0;
        let revenueLines = [];
        let summary = { byCurrency: {}, paidCount: 0, refundedCount: 0 };

        if (!process.env.STRIPE_SECRET_KEY) {
            notes.push('STRIPE_SECRET_KEY is not set, so revenue and membership counts are unavailable.');
        } else {
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

            const charges = await stripe.charges
                .list({ created: { gte: w.startSec, lt: w.endSec }, limit: 100 })
                .autoPagingToArray({ limit: 1000 });
            summary = summarizeCharges(charges);

            revenueLines = Object.entries(summary.byCurrency).map(([currency, t]) => ({
                currency,
                net: formatMoney(t.net, currency),
                gross: formatMoney(t.gross, currency),
                refunded: t.refunded ? formatMoney(t.refunded, currency) : null,
                count: t.count,
            }));

            // Completed checkout sessions, not charges: a renewal on a
            // subscription is revenue but is not somebody buying a membership,
            // and counting it as one would overstate growth every month.
            const sessions = await stripe.checkout.sessions
                .list({ created: { gte: w.startSec, lt: w.endSec }, limit: 100 })
                .autoPagingToArray({ limit: 1000 });
            memberships = sessions.filter(s => s.status === 'complete').length;

            const prevSessions = await stripe.checkout.sessions
                .list({ created: { gte: w.prevStartSec, lt: w.startSec }, limit: 100 })
                .autoPagingToArray({ limit: 1000 });
            prevMemberships = prevSessions.filter(s => s.status === 'complete').length;
        }

        const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);
        const stats = {
            rangeLabel: `${fmtDay(w.start)} to ${fmtDay(w.end)}`,
            signups,
            signupsDelta: deltaLabel(signups, prevSignups),
            memberships,
            membershipsDelta: deltaLabel(memberships, prevMemberships),
            revenueLines,
            totalUsers: users.length,
            totalPro: totalPro || 0,
            notes,
        };

        const html = buildAdminStatsEmailHtml(stats);
        const subject = `Huddle weekly: ${signups} signup${signups === 1 ? '' : 's'}, ${memberships} membership${memberships === 1 ? '' : 's'}`;

        if (!dryRun) {
            if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
                throw new Error('Resend is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL missing).');
            }
            await sendReport(subject, html);
        }

        return res.status(200).json({
            sent: !dryRun,
            to: dryRun ? null : REPORT_TO,
            ...stats,
            paidCharges: summary.paidCount,
            chargesWithRefunds: summary.refundedCount,
        });
    } catch (error) {
        const message = error?.message || (typeof error === 'string' ? error : JSON.stringify(error));
        console.error('Admin stats report failed:', message);
        return res.status(500).json({ error: message });
    }
}
