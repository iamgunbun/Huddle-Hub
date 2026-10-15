import assert from 'node:assert/strict';

// api/admin-stats.js builds its Supabase client at module load, the same as
// every other api/*.js file, so these have to exist before the dynamic import
// below. Nothing here ever talks to Supabase or Stripe.
process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key-for-verify-script-only';

// This endpoint emails real revenue figures to the owner once a week,
// unattended. Nobody proof-reads it before it sends, and a money bug here
// doesn't look like a bug -- it looks like a business result. That is what
// these checks are for.
const {
    minorToMajor, formatMoney, reportWindow, summarizeCharges,
    countCreatedWithin, deltaLabel, buildAdminStatsEmailHtml,
} = await import('../api/admin-stats.js');

let checks = 0;
const check = (name, actual, expected) => {
    try {
        assert.deepEqual(actual, expected);
        checks++;
    } catch (err) {
        console.error(`FAIL: ${name}`);
        throw err;
    }
};

// --- Currency units ---
//
// Stripe reports the smallest unit of the currency, which is not always 1/100.
// Blanket-dividing by 100 would report a 5000-yen sale as 50 yen.
check('a USD amount in cents converts to dollars', minorToMajor(1999, 'usd'), 19.99);
check('a zero-decimal currency is not divided', minorToMajor(5000, 'jpy'), 5000);
check('currency case does not change the conversion', minorToMajor(5000, 'JPY'), 5000);
check('USD formats with cents', formatMoney(1999, 'usd'), '$19.99');
check('a zero-decimal currency formats with no decimal part', formatMoney(5000, 'jpy'), '¥5,000');
// Intl accepts any well-formed three-letter code, so an unfamiliar one
// formats normally; only a malformed code reaches the fallback. Both paths
// must produce a number rather than taking the whole report down.
const plain = (str) => str.replace(/\u00a0/g, ' ');
check('an unfamiliar but well-formed currency code formats normally',
    plain(formatMoney(1234, 'zzz')), 'ZZZ 12.34');
check('a malformed currency code falls back instead of throwing',
    formatMoney(1234, 'xx'), '12.34 XX');

// --- The reporting window ---
const now = new Date('2026-10-19T14:00:00.000Z');
const w = reportWindow(now);
check('the window covers the seven days ending now',
    [new Date(w.start).toISOString(), new Date(w.end).toISOString()],
    ['2026-10-12T14:00:00.000Z', '2026-10-19T14:00:00.000Z']);
check('the comparison window is the seven days before that',
    [new Date(w.prevStart).toISOString(), new Date(w.prevEnd).toISOString()],
    ['2026-10-05T14:00:00.000Z', '2026-10-12T14:00:00.000Z']);
check('the two windows meet exactly, with no gap or overlap', w.prevEnd, w.start);
check('Stripe gets unix seconds, not milliseconds', w.startSec, Math.floor(w.start / 1000));

// --- Charge totals ---
//
// The refund case is the one that matters most: a week with a sale and an
// equal refund made nothing, and reporting the gross would be a false
// business result the owner might act on.
const charges = [
    { status: 'succeeded', paid: true, currency: 'usd', amount: 2000, amount_refunded: 0 },
    { status: 'succeeded', paid: true, currency: 'usd', amount: 2000, amount_refunded: 2000 },
    { status: 'succeeded', paid: true, currency: 'usd', amount: 500, amount_refunded: 100 },
    { status: 'failed', paid: false, currency: 'usd', amount: 9900, amount_refunded: 0 },
    { status: 'succeeded', paid: true, currency: 'eur', amount: 1000, amount_refunded: 0 },
];
const s = summarizeCharges(charges);
check('a failed charge is not counted as revenue', s.paidCount, 4);
check('gross is the sum of successful charges', s.byCurrency.usd.gross, 4500);
check('refunds are subtracted from net', s.byCurrency.usd.net, 2400);
check('refunds are reported separately too', s.byCurrency.usd.refunded, 2100);
check('a fully refunded charge still counts as a payment that happened', s.byCurrency.usd.count, 3);
check('charges with refunds are tallied', s.refundedCount, 2);
check('currencies are kept apart rather than added together', s.byCurrency.eur.net, 1000);
check('no charges yields no currencies rather than a zero that implies USD',
    summarizeCharges([]).byCurrency, {});
check('a null charge list does not throw', summarizeCharges(null).paidCount, 0);

// --- Signup counting ---
const users = [
    { created_at: '2026-10-13T00:00:00.000Z' },  // in window
    { created_at: '2026-10-18T23:59:59.000Z' },  // in window
    { created_at: '2026-10-12T14:00:00.000Z' },  // exactly the start: in
    { created_at: '2026-10-19T14:00:00.000Z' },  // exactly the end: out
    { created_at: '2026-10-07T00:00:00.000Z' },  // previous window
    { created_at: null },
    {},
];
check('signups inside the window are counted', countCreatedWithin(users, w.start, w.end), 3);
check('the window start is inclusive and the end exclusive, so no user is counted twice',
    countCreatedWithin(users, w.start, w.end) + countCreatedWithin(users, w.prevStart, w.prevEnd), 4);
check('a missing created_at is skipped rather than counted as now',
    countCreatedWithin([{ created_at: null }, {}], w.start, w.end), 0);
check('an unparseable created_at is skipped',
    countCreatedWithin([{ created_at: 'not a date' }], w.start, w.end), 0);

// --- Week-over-week label ---
check('an increase reads as a positive delta', deltaLabel(5, 2), '+3 vs last week');
check('a decrease reads as a negative delta', deltaLabel(2, 5), '-3 vs last week');
check('an unchanged figure says so rather than showing +0', deltaLabel(4, 4), 'no change vs last week');
check('two quiet weeks do not produce a meaningless percentage', deltaLabel(0, 0), 'no change vs last week');

// --- The email itself ---
const html = buildAdminStatsEmailHtml({
    rangeLabel: '2026-10-12 to 2026-10-19',
    signups: 12, signupsDelta: '+4 vs last week',
    memberships: 3, membershipsDelta: '+1 vs last week',
    revenueLines: [{ currency: 'usd', net: '$24.00', gross: '$45.00', refunded: '$21.00', count: 3 }],
    totalUsers: 140, totalPro: 19, notes: ['Test note.'],
});
check('the report shows the net figure', html.includes('$24.00'), true);
check('the report shows gross and refunds, so net can be checked', html.includes('$45.00') && html.includes('$21.00'), true);
check('the report shows signups and memberships', html.includes('12') && html.includes('3'), true);
check('the report carries notes about incomplete data', html.includes('Test note.'), true);

const empty = buildAdminStatsEmailHtml({
    rangeLabel: 'r', signups: 0, signupsDelta: 'no change vs last week',
    memberships: 0, membershipsDelta: 'no change vs last week',
    revenueLines: [], totalUsers: 0, totalPro: 0, notes: [],
});
check('a week with no payments says so instead of rendering an empty block',
    empty.includes('No payments in this period.'), true);

// A league or note containing HTML must not break out into the markup.
const injected = buildAdminStatsEmailHtml({
    rangeLabel: 'r', signups: 0, signupsDelta: 'x', memberships: 0, membershipsDelta: 'x',
    revenueLines: [], totalUsers: 0, totalPro: 0,
    notes: ['<script>alert(1)</script>'],
});
check('note text is escaped rather than injected as markup',
    injected.includes('<script>alert(1)</script>'), false);
check('the escaped form is what appears', injected.includes('&lt;script&gt;'), true);

console.log(`OK: ${checks} admin-stats checks passed`);
