// api/espn-proxy.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { leagueId, year, espnS2, swid, userId, views, scoringPeriodId } = req.body;

        // Both go straight into the request URL below, so they're validated as
        // plain numbers rather than trusted as-is.
        if (!/^\d+$/.test(String(leagueId || '')) || !/^\d{4}$/.test(String(year || ''))) {
            return res.status(400).json({ error: 'Missing or invalid leagueId/year' });
        }

        // Every caller asks for its own combination of views (settings/teams for
        // the league card, rosters for a team's players, matchups for the
        // schedule, transactions, or the draft board) in one request -- ESPN
        // accepts as many `view=` params as are asked for on the same URL, so
        // there's no need for a separate endpoint per resource the way Yahoo's
        // proxy has. Restricted to a known set since these also go straight
        // into the request URL.
        const ALLOWED_VIEWS = new Set(['mSettings', 'mTeam', 'mRoster', 'mMatchup', 'mMatchupScore', 'mTransactions2', 'mDraftDetail']);
        const requestedViews = (Array.isArray(views) ? views.filter(v => ALLOWED_VIEWS.has(v)) : []);
        const safeViews = requestedViews.length ? requestedViews : ['mSettings', 'mTeam', 'mRoster'];
        const viewParams = safeViews.map(v => `view=${v}`).join('&');
        const safeScoringPeriod = Number.isInteger(scoringPeriodId) && scoringPeriodId > 0 && scoringPeriodId < 100 ? scoringPeriodId : null;
        const scoringPeriodParam = safeScoringPeriod ? `&scoringPeriodId=${safeScoringPeriod}` : '';
        const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?${viewParams}${scoringPeriodParam}`;

        // Cookies passed directly (the initial "try connecting" preview, before
        // there's anything saved yet) take priority. Otherwise, every OTHER
        // page in the app just says "this is user X" and expects the same
        // cookies that worked at connect time to still be there -- stored the
        // same way Yahoo's OAuth tokens are, one row per user per provider.
        let cookieEspnS2 = espnS2;
        let cookieSwid = swid;

        if ((!cookieEspnS2 || !cookieSwid) && userId) {
            const { data: stored } = await supabase
                .from('user_integrations')
                .select('access_token, refresh_token')
                .eq('user_id', userId)
                .eq('provider', 'espn')
                .maybeSingle();

            if (stored) {
                cookieEspnS2 = cookieEspnS2 || stored.access_token;
                cookieSwid = cookieSwid || stored.refresh_token;
            }
        }

        const headers = {};
        if (cookieEspnS2 && cookieSwid) {
            headers['Cookie'] = `espn_s2=${cookieEspnS2}; SWID=${cookieSwid};`;
        }

        const response = await fetch(url, { headers });

        if (response.status === 401) {
            return res.status(401).json({ error: "Private ESPN League: Invalid or expired cookies." });
        }

        if (!response.ok) {
            return res.status(response.status).json({ error: `ESPN returned status ${response.status}` });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("ESPN Proxy Error:", error);
        return res.status(500).json({ error: 'Failed to securely fetch from ESPN.' });
    }
}
