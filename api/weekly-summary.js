// api/weekly-summary.js
//
// The Pro "Weekly Summary" feature: every Tuesday (see vercel.json's cron
// entry), this generates one recap per Sleeper league that has at least one
// Pro member, stores it (league_weekly_summaries -- read by
// src/pages/WeeklySummary.jsx), and emails it to every Pro member in that
// league. Sleeper only for now -- Yahoo and ESPN need per-user OAuth/cookie
// handling this endpoint doesn't have yet, so a league on either platform is
// silently skipped rather than guessed at.
//
// Every number in the email is computed here from Sleeper's own API
// responses -- matchup scores, real per-player actual points, and real
// weekly projections scored under the league's own rules (scoreStatLine,
// same function the client already uses for this). Gemini is only ever
// handed those already-verified facts and asked to narrate them -- the same
// "give it real facts, let it write flavor" split api/evaluate.js's manager
// report already uses -- specifically so it cannot invent a score, a name,
// or a stat that didn't happen.
//
// Manual testing, since this runs unattended and there's no way to exercise
// a Tuesday cron trigger directly: GET this endpoint (same auth as the real
// cron -- see below) with `?leagueId=<leagues.id>` to run just one league,
// and `&dryRun=1` to compute and return the summary WITHOUT writing to the
// database or sending any email.

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType } from '@google/generative-ai';
import { scoreStatLine } from '../src/utils/yahooScoring.js';

const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
// A starter has to have been a real, rosterable factor for a low score to
// read as a "disappointment" rather than just a bench-caliber player doing
// bench-caliber-player things -- gated on a real weekly projection instead
// of a arbitrary points floor, since a projection already accounts for who
// this specific player was expected to be this specific week.
const DISAPPOINTMENT_MIN_PROJECTION = 8;

export const teamNameFor = (rosterId, rosters, users) => {
    const roster = rosters.find(r => r.roster_id === rosterId);
    const user = users.find(u => u.user_id === roster?.owner_id);
    return user?.metadata?.team_name || user?.display_name || `Team ${rosterId}`;
};

/**
 * Every number this week's email/app card can show, computed from Sleeper's
 * own responses only -- nothing here is inferred or generated.
 */
export const computeWeekStats = ({ matchups, rosters, users, transactions, players, projById, week }) => {
    const byMatchup = {};
    matchups.forEach(m => {
        if (!byMatchup[m.matchup_id]) byMatchup[m.matchup_id] = [];
        byMatchup[m.matchup_id].push(m);
    });

    const games = Object.values(byMatchup)
        .filter(pair => pair.length === 2)
        .map(([a, b]) => {
            const scoreA = a.points || 0;
            const scoreB = b.points || 0;
            const nameA = teamNameFor(a.roster_id, rosters, users);
            const nameB = teamNameFor(b.roster_id, rosters, users);
            return {
                teamA: nameA, teamB: nameB, scoreA, scoreB,
                margin: Math.round(Math.abs(scoreA - scoreB) * 100) / 100,
                winner: scoreA === scoreB ? null : (scoreA > scoreB ? nameA : nameB),
            };
        });

    const byMargin = [...games].sort((x, y) => y.margin - x.margin);
    const blowout = byMargin[0] || null;
    const closestCall = byMargin.length ? byMargin[byMargin.length - 1] : null;

    // Rivalry angle: this week's matchup between the two teams whose season
    // records are closest to each other -- the most evenly matched pairing
    // actually on the schedule this week, which is what "rivalry... based
    // off records" asked for without needing multi-season history.
    const recordOf = (rosterId) => {
        const r = rosters.find(x => x.roster_id === rosterId)?.settings || {};
        return (r.wins || 0) - (r.losses || 0);
    };
    let rivalry = null;
    let smallestGap = Infinity;
    Object.values(byMatchup).filter(pair => pair.length === 2).forEach(([a, b]) => {
        const gap = Math.abs(recordOf(a.roster_id) - recordOf(b.roster_id));
        if (gap < smallestGap) {
            smallestGap = gap;
            rivalry = { teamA: teamNameFor(a.roster_id, rosters, users), teamB: teamNameFor(b.roster_id, rosters, users), recordGap: gap };
        }
    });

    // Every starter, league-wide, with their real actual points and (when
    // available) their real projection scored under this league's rules --
    // the shared pool both position MVPs and the disappointment call draw
    // from.
    const starterPerf = [];
    matchups.forEach(m => {
        (m.starters || []).forEach((pid, idx) => {
            if (!pid || pid === '0') return;
            const info = players[pid];
            if (!info) return;
            const actual = (m.starters_points || [])[idx] ?? 0;
            starterPerf.push({
                playerId: pid,
                name: `${info.first_name || ''} ${info.last_name || ''}`.trim() || `Player #${pid}`,
                position: info.position,
                team: teamNameFor(m.roster_id, rosters, users),
                actual: Math.round(actual * 100) / 100,
                projected: projById[pid] ?? null,
            });
        });
    });

    const mvpByPosition = {};
    POSITIONS.forEach(pos => {
        const atPos = starterPerf.filter(p => p.position === pos);
        if (atPos.length) {
            mvpByPosition[pos] = [...atPos].sort((a, b) => b.actual - a.actual)[0];
        }
    });

    const disappointments = starterPerf
        .filter(p => p.projected != null && p.projected >= DISAPPOINTMENT_MIN_PROJECTION)
        .map(p => ({ ...p, variance: Math.round((p.actual - p.projected) * 100) / 100 }))
        .sort((a, b) => a.variance - b.variance);
    const biggestDisappointment = disappointments[0] || null;

    const waiverMoves = transactions.filter(t => t.type === 'waiver' || t.type === 'free_agent');
    const trades = transactions.filter(t => t.type === 'trade');
    const transactionSummary = {
        waiverCount: waiverMoves.length,
        tradeCount: trades.length,
        notableAdds: waiverMoves.slice(0, 10).map(t => {
            const rosterId = (t.roster_ids || [])[0];
            const addedIds = Object.keys(t.adds || {});
            return {
                team: teamNameFor(rosterId, rosters, users),
                added: addedIds.map(id => players[id] ? `${players[id].first_name} ${players[id].last_name}`.trim() : `Player #${id}`),
                faab: t.settings?.waiver_bid ?? null,
            };
        }),
        trades: trades.slice(0, 10).map(t => {
            const rosterIds = t.roster_ids || [];
            return {
                teams: rosterIds.map(rId => teamNameFor(rId, rosters, users)),
                playersMoved: Object.keys(t.adds || {}).map(id => players[id] ? `${players[id].first_name} ${players[id].last_name}`.trim() : `Player #${id}`),
            };
        }),
    };

    return { week, games, blowout, closestCall, rivalry, mvpByPosition, biggestDisappointment, transactions: transactionSummary };
};

const buildNarrativePrompt = (leagueName, stats) => `You are writing a fun, banter-filled weekly recap email for the fantasy football league "${leagueName}", covering Week ${stats.week}. This goes out to every manager in the league, so the tone should read like a knowledgeable, slightly cheeky league commissioner's newsletter -- not a generic sports report.

CRITICAL GROUNDING RULE: Every fact, score, name, and number below is real and verified. You must ONLY reference what's in this data. Never invent a score, a player, a team name, or a stat that isn't listed here.

THIS WEEK'S DATA:
${JSON.stringify(stats, null, 2)}

Write a recap with these sections, each 1-3 sentences, punchy and specific (use the real names/numbers, don't be generic):
- headline: A punchy 5-10 word headline for the week.
- matchupRecap: Cover the week's matchups, calling out the biggest blowout and the closest call by name and score.
- mvpSpotlight: Call out the standout position MVPs (the highest scorer at each position) by name.
- disappointmentOfTheWeek: Playfully roast the biggest disappointment (if one exists in the data), by name, comparing their actual score to what they were projected for.
- rivalryWatch: Frame this week's most evenly-matched-by-record matchup as a rivalry, if one exists in the data.
- waiverWireBuzz: Summarize the week's trades and waiver activity -- who made moves, and any FAAB bids worth calling out.

If a section's underlying data is empty or missing (e.g. no trades happened, or no disappointment qualified), say so briefly and move on -- never fabricate content to fill a section.`;

const NARRATIVE_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        headline: { type: SchemaType.STRING },
        matchupRecap: { type: SchemaType.STRING },
        mvpSpotlight: { type: SchemaType.STRING },
        disappointmentOfTheWeek: { type: SchemaType.STRING },
        rivalryWatch: { type: SchemaType.STRING },
        waiverWireBuzz: { type: SchemaType.STRING },
    },
    required: ['headline', 'matchupRecap', 'mvpSpotlight', 'disappointmentOfTheWeek', 'rivalryWatch', 'waiverWireBuzz'],
};

const generateNarrative = async (leagueName, stats) => {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: 'gemini-3.5-flash',
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: { responseMimeType: 'application/json', responseSchema: NARRATIVE_SCHEMA },
    });
    const result = await model.generateContent(buildNarrativePrompt(leagueName, stats));
    if (!result.response.candidates || result.response.candidates.length === 0) {
        throw new Error('Gemini blocked the weekly summary response.');
    }
    return JSON.parse(result.response.text());
};

const escapeHtml = (str) => String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const APP_URL = 'https://huddleff.app';

const buildEmailHtml = (leagueName, narrative) => {
    const section = (title, body) => `
        <tr><td style="padding: 16px 0; border-bottom: 1px solid #eee;">
            <div style="font-weight: 700; font-size: 14px; color: #111; margin-bottom: 4px;">${escapeHtml(title)}</div>
            <div style="font-size: 14px; color: #444; line-height: 1.5;">${escapeHtml(body)}</div>
        </td></tr>`;
    return `
    <div style="background:#0b0f16; padding: 32px 16px; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;">
            <tr>
                <td style="background: #111318; padding: 28px 32px; text-align: center;">
                    <img src="${APP_URL}/brand.png" alt="Huddle" width="64" height="64" style="display:block; margin: 0 auto 8px;" />
                    <div style="color: #eebf1c; font-weight: 800; letter-spacing: 1px; font-size: 14px;">HUDDLE WEEKLY SUMMARY</div>
                </td>
            </tr>
            <tr>
                <td style="padding: 28px 32px 8px;">
                    <h1 style="margin: 0 0 4px; font-size: 20px; color: #111;">${escapeHtml(narrative.headline)}</h1>
                    <p style="margin: 0 0 8px; font-size: 13px; color: #888;">${escapeHtml(leagueName)}</p>
                </td>
            </tr>
            <tr><td style="padding: 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${section('Matchup Recap', narrative.matchupRecap)}
                ${section('MVP Spotlight', narrative.mvpSpotlight)}
                ${section('Disappointment of the Week', narrative.disappointmentOfTheWeek)}
                ${section('Rivalry Watch', narrative.rivalryWatch)}
                ${section('Waiver Wire Buzz', narrative.waiverWireBuzz)}
            </table></td></tr>
            <tr>
                <td style="padding: 24px 32px; text-align: center;">
                    <a href="${APP_URL}/weekly-summary" style="display: inline-block; padding: 12px 28px; background: #eebf1c; color: #111; text-decoration: none; font-weight: 700; font-size: 14px; border-radius: 8px;">See the Full Summary</a>
                </td>
            </tr>
            <tr>
                <td style="padding: 20px 32px; background: #f7f7f8; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #888;">
                        You're getting this because you're a Huddle Pro subscriber in ${escapeHtml(leagueName)}.
                        Manage your subscription in <a href="${APP_URL}/account" style="color: #888;">Account Settings</a>.
                    </p>
                </td>
            </tr>
        </table>
    </div>`;
};

const sendSummaryEmail = async (email, leagueName, narrative) => {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        console.error('Resend is not configured -- skipping weekly summary email send.');
        return { sent: false, reason: 'not_configured' };
    }
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: email,
            subject: `${leagueName} Week ${narrative.week || ''} Recap: ${narrative.headline}`,
            html: buildEmailHtml(leagueName, narrative),
        }),
    });
    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        console.error('Weekly summary email failed:', errBody);
        return { sent: false, reason: 'send_failed' };
    }
    return { sent: true };
};

const fetchJson = async (url, options) => {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
};

const generateForLeague = async ({ leagueDbId, sleeperLeagueId, leagueName, week, playersCache, projectionsCache }) => {
    const [leagueMeta, matchups, rosters, users, transactions] = await Promise.all([
        fetchJson(`https://api.sleeper.app/v1/league/${sleeperLeagueId}`),
        fetchJson(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/matchups/${week}`),
        fetchJson(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/rosters`),
        fetchJson(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/users`),
        fetchJson(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/transactions/${week}`),
    ]);

    const season = leagueMeta.season;
    const scoringSettings = leagueMeta.scoring_settings || {};
    const cacheKey = `${season}:${week}`;
    if (!projectionsCache.has(cacheKey)) {
        const rawProjections = await fetchJson(`https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular`).catch(() => []);
        const byId = {};
        (rawProjections || []).forEach(proj => {
            const projPos = proj.player?.position || proj.position;
            byId[proj.player_id] = scoreStatLine(proj.stats, scoringSettings, projPos) ?? null;
        });
        projectionsCache.set(cacheKey, byId);
    }

    const stats = computeWeekStats({
        matchups: Array.isArray(matchups) ? matchups : [],
        rosters: Array.isArray(rosters) ? rosters : [],
        users: Array.isArray(users) ? users : [],
        transactions: Array.isArray(transactions) ? transactions : [],
        players: playersCache,
        projById: projectionsCache.get(cacheKey),
        week,
    });

    const narrative = await generateNarrative(leagueName, stats);
    narrative.week = week;

    return { leagueDbId, season: String(season), week, stats, narrative };
};

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Vercel attaches this exact header to its own cron-triggered requests
    // when CRON_SECRET is set on the project -- see vercel.json and the PR
    // description for setup. Also accepted here for a manual/backfill run.
    if (!process.env.CRON_SECRET || req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: 'Missing Gemini API Key.' });
    }

    const query = req.query || {};
    const dryRun = query.dryRun === '1' || query.dryRun === 'true';
    const onlyLeagueId = query.leagueId || null;
    // Overridable for backfilling a specific week during manual testing --
    // defaults to "the week that just finished" (the cron fires Tuesday, and
    // Sleeper's own `week` can already reflect the upcoming week by then).
    const weekOverride = query.week ? parseInt(query.week, 10) : null;

    try {
        const { data: memberships, error: memErr } = await supabase
            .from('user_leagues')
            .select('league_id, user_id, leagues!inner(id, sleeper_league_id, platform, league_name, season), profiles!inner(is_premium, email)');
        if (memErr) throw memErr;

        const proLeagues = new Map();
        (memberships || []).forEach(row => {
            const league = row.leagues;
            const profile = row.profiles;
            if (!league || league.platform !== 'sleeper') return;
            if (onlyLeagueId && league.id !== onlyLeagueId) return;
            if (!profile?.is_premium || !profile?.email) return;

            if (!proLeagues.has(league.id)) {
                proLeagues.set(league.id, { league, emails: new Set() });
            }
            proLeagues.get(league.id).emails.add(profile.email);
        });

        if (proLeagues.size === 0) {
            return res.status(200).json({ processed: 0, message: 'No Sleeper leagues with a Pro member found.' });
        }

        const playersCache = await fetchJson('https://api.sleeper.app/v1/players/nfl');
        const projectionsCache = new Map();

        const results = [];
        for (const { league, emails } of proLeagues.values()) {
            try {
                let week = weekOverride;
                if (!week) {
                    const nflState = await fetchJson('https://api.sleeper.app/v1/state/nfl');
                    const currentWeek = nflState.week || nflState.display_week || 1;
                    // "The week that just finished" -- by the time this cron
                    // fires (Tuesday), Sleeper's own current-week pointer has
                    // typically already rolled forward to the upcoming week.
                    week = Math.max(1, currentWeek - 1);
                }

                const generated = await generateForLeague({
                    leagueDbId: league.id,
                    sleeperLeagueId: league.sleeper_league_id,
                    leagueName: league.league_name || 'Your League',
                    week,
                    playersCache,
                    projectionsCache,
                });

                if (!dryRun) {
                    const { error: upsertErr } = await supabase
                        .from('league_weekly_summaries')
                        .upsert({
                            league_id: generated.leagueDbId,
                            season: generated.season,
                            week: generated.week,
                            stats: generated.stats,
                            narrative: generated.narrative,
                            generated_at: new Date().toISOString(),
                        }, { onConflict: 'league_id,season,week' });
                    if (upsertErr) throw upsertErr;

                    for (const email of emails) {
                        await sendSummaryEmail(email, league.league_name || 'Your League', generated.narrative);
                    }
                }

                results.push({ leagueId: league.id, leagueName: league.league_name, week: generated.week, emailsSent: dryRun ? 0 : emails.size, ...(dryRun ? { stats: generated.stats, narrative: generated.narrative } : {}) });
            } catch (leagueErr) {
                console.error(`Weekly summary failed for league ${league.id}:`, leagueErr);
                results.push({ leagueId: league.id, leagueName: league.league_name, error: leagueErr.message });
            }
        }

        return res.status(200).json({ processed: results.length, dryRun, results });
    } catch (error) {
        console.error('weekly-summary handler error:', error);
        return res.status(500).json({ error: error.toString() });
    }
}
