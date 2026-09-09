// api/weekly-summary.js
//
// The Pro "Weekly Summary" feature: every Tuesday (see vercel.json's cron
// entry), this generates one recap per Sleeper, Yahoo, or ESPN league that
// has at least one Pro member, stores it (league_weekly_summaries -- read by
// src/pages/WeeklySummary.jsx), and emails it to every Pro member in that
// league.
//
// Every number in the email is computed here from the platform's own API
// responses -- matchup scores, real per-player actual points where the
// platform publishes them, and real weekly projections. Sleeper and ESPN
// both publish real per-player projections (Sleeper's scored here under the
// league's own rules via scoreStatLine, ESPN's read directly off its own
// boxscore response), so both are fed through the SAME computeWeekStats
// below -- ESPN's data is just reshaped into that same input shape first
// (buildEspnStatsInputs) rather than given its own compute function, since
// there's no real difference in what's available to redefine anything for.
// Yahoo publishes NO per-player projection through its API -- only a
// per-TEAM one -- so the Yahoo path (computeYahooWeekStats below) is a
// genuinely separate pipeline that redefines "biggest disappointment" at
// the team level instead of guessing a player-level number Yahoo never
// actually gives out. Gemini is only ever handed those already-verified
// facts and asked to narrate them -- the same "give it real facts, let it
// write flavor" split api/evaluate.js's manager report already uses --
// specifically so it cannot invent a score, a name, or a stat that didn't
// happen.
//
// Manual testing, since this runs unattended and there's no way to exercise
// a Tuesday cron trigger directly: GET this endpoint (same auth as the real
// cron -- see below) with `?leagueId=<leagues.id>` to run just one league,
// and `&dryRun=1` to compute and return the summary WITHOUT writing to the
// database or sending any email.

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType } from '@google/generative-ai';
import { scoreStatLine } from '../src/utils/yahooScoring.js';
import {
    yahooCollection,
    yahooField,
    yahooText,
    findNode,
    parseYahooScoreboard,
    parseYahooStandings,
    parseYahooTransactions,
    parseYahooPlayers,
    weekFromTimestamp,
} from '../src/utils/yahooHistory.js';
import {
    parseEspnLeagueRosters,
    parseEspnSchedule,
    parseEspnTransactions,
    parseEspnAthleteResponse,
    espnDefenseMetaFromId,
} from '../src/utils/espnParsers.js';
import { fromEspnLeagueId } from '../src/utils/platformIds.js';

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

// --------------------------------------------------------------------------
// ESPN -- reshaped into computeWeekStats' own input shape and run through
// THAT function, rather than a separate compute function of its own. Unlike
// Yahoo, ESPN's boxscore response carries a real per-player projection
// alongside the real actual (parseEspnRosterEntry's projectedPoints/
// actualPoints), so there's nothing about "biggest disappointment" or any
// other stat here that needs to be defined differently for ESPN -- only the
// shape of the response needs converting.
// --------------------------------------------------------------------------

/**
 * Turns already-parsed ESPN data (parseEspnSchedule's byWeek, parseEspnLeagueRosters's
 * rosters/playersMeta, parseEspnTransactions' rows) into exactly the shape
 * computeWeekStats expects from Sleeper. Kept as its own pure, exported
 * function -- separate from the network calls in generateForEspnLeague below --
 * so this reshape (the one genuinely new piece of logic in the ESPN path) can
 * be checked directly instead of only through a live request.
 */
export const buildEspnStatsInputs = ({ byWeek, week, rosters, playersMeta, transactions }) => {
    const pairs = byWeek[week] || [];
    const matchups = [];
    pairs.forEach((teams, idx) => {
        teams.forEach(t => {
            const roster = rosters[t.roster_id];
            const starters = roster?.starters || [];
            matchups.push({
                matchup_id: idx + 1,
                roster_id: t.roster_id,
                points: t.points || 0,
                starters,
                starters_points: starters.map(pid => playersMeta[pid]?.actualPoints ?? 0),
            });
        });
    });

    const rostersList = Object.values(rosters);
    // computeWeekStats resolves a team's name via a users[] row keyed by
    // owner_id (Sleeper's shape, one account per team) -- ESPN's roster
    // already carries its team name directly, so each roster gets a
    // matching synthetic "user" row instead of a real lookup.
    const users = rostersList.map(r => ({ user_id: r.owner_id, display_name: r.team_name, metadata: {} }));

    const players = {};
    const projById = {};
    Object.entries(playersMeta).forEach(([id, meta]) => {
        players[id] = { first_name: meta.fn, last_name: meta.ln, position: meta.pos };
        if (meta.projectedPoints != null) projById[id] = meta.projectedPoints;
    });

    const weekTransactions = transactions.filter(t => t.leg === week);

    return { matchups, rosters: rostersList, users, transactions: weekTransactions, players, projById, week };
};

// --------------------------------------------------------------------------
// Yahoo -- a fully separate stat pipeline, deliberately not sharing code
// with computeWeekStats above. Yahoo's data shape is different enough
// (team-level projections only, OAuth-gated requests, a season-long
// transaction feed instead of a per-week one) that forcing it through the
// same function would mean branching almost every line of that function --
// and any bug introduced doing that could regress the already-verified,
// already-shipping Sleeper path. Keeping them apart costs some duplication
// and buys zero regression risk to Sleeper.
// --------------------------------------------------------------------------

export const teamNameForYahoo = (rosterId, standingsRows) => {
    const row = standingsRows.find(r => r.rosterId === rosterId);
    return row?.teamName || `Team ${rosterId}`;
};

const YAHOO_BENCH_SLOTS = new Set(['BN', 'IR', 'IR+', 'NA']);

/**
 * Per-team roster rows (name, position, actual points, starter/bench) out of
 * a `teams;team_keys=.../roster;week=N/players/stats;type=week;week=N`
 * response. parseYahooTeamPlayerPoints (yahooHistory.js) already reads this
 * same shape but only keeps points -- name, position and selected_position
 * are read here the same way (via yahooField/yahooCollection), since the
 * weekly summary needs to say WHO the points belong to, not just the number.
 *
 * Returns { [teamKey]: [{ playerId, name, position, actual, isStarter }] }.
 */
export const extractYahooRosterPlayers = (data) => {
    const byTeam = {};
    const teamsNode = data?.fantasy_content?.teams
        || findNode(data?.fantasy_content?.league, 'teams')
        || findNode(data?.fantasy_content, 'teams');

    yahooCollection(teamsNode).forEach(entry => {
        const team = entry?.team;
        if (!team) return;

        const info = Array.isArray(team) ? team[0] : team;
        const teamKey = yahooText(yahooField(info, 'team_key'));
        if (!teamKey) return;

        const roster = findNode(team, 'roster');
        const playersNode = findNode(roster, 'players') || findNode(team, 'players');
        const rows = [];

        yahooCollection(playersNode).forEach(playerEntry => {
            const player = playerEntry?.player;
            if (!player) return;

            const playerInfo = Array.isArray(player) ? player[0] : player;
            const playerId = yahooText(yahooField(playerInfo, 'player_id'));
            if (!playerId) return;

            const pointsNode = Array.isArray(player)
                ? player.find(x => x && x.player_points)?.player_points
                : player.player_points;
            const actual = pointsNode?.total !== undefined ? (parseFloat(pointsNode.total) || 0) : 0;

            // selected_position is itself an entity (Yahoo's array-of-
            // single-key-objects shape), so it's read with the same
            // yahooField helper used for every other field here rather than
            // a hand-rolled path into it.
            const selectedPositionNode = yahooField(player, 'selected_position');
            const selectedPosition = yahooText(yahooField(selectedPositionNode, 'position'));

            const nameNode = yahooField(playerInfo, 'name');
            const name = yahooText(nameNode?.full) || `Player #${playerId}`;
            const position = yahooText(yahooField(playerInfo, 'display_position')) || selectedPosition || '';

            rows.push({
                playerId,
                name,
                position,
                actual: Math.round(actual * 100) / 100,
                // No selected_position read back is treated as bench --
                // i.e. this player is left out of MVP consideration rather
                // than risk crowning someone who never started.
                isStarter: !!selectedPosition && !YAHOO_BENCH_SLOTS.has(selectedPosition),
            });
        });

        if (rows.length) byTeam[teamKey] = rows;
    });

    return byTeam;
};

/**
 * Yahoo's equivalent of computeWeekStats. Two real differences from
 * Sleeper's version, both forced by what Yahoo's API actually publishes:
 *
 *  - biggestDisappointment is a TEAM (Yahoo's own team-level points vs.
 *    team-level projected_points from the scoreboard), not a player --
 *    Yahoo has no per-player projection to compare a player's actual
 *    points against.
 *  - starterPerf/mvpByPosition draws only from players extractYahooRosterPlayers
 *    marked as started (selected_position outside the bench/IR slots), since
 *    Yahoo's roster response includes the whole bench too.
 */
export const computeYahooWeekStats = ({ scoreboardWeek, standingsRows, transactions, rosterPlayersByTeamKey, playerMeta, week }) => {
    const games = scoreboardWeek
        .filter(m => m.teams?.length === 2)
        .map(m => {
            const [a, b] = m.teams;
            const scoreA = a.points || 0;
            const scoreB = b.points || 0;
            const nameA = teamNameForYahoo(a.roster_id, standingsRows);
            const nameB = teamNameForYahoo(b.roster_id, standingsRows);
            return {
                teamA: nameA, teamB: nameB, scoreA, scoreB,
                margin: Math.round(Math.abs(scoreA - scoreB) * 100) / 100,
                winner: scoreA === scoreB ? null : (scoreA > scoreB ? nameA : nameB),
            };
        });

    const byMargin = [...games].sort((x, y) => y.margin - x.margin);
    const blowout = byMargin[0] || null;
    const closestCall = byMargin.length ? byMargin[byMargin.length - 1] : null;

    const recordOf = (rosterId) => {
        const row = standingsRows.find(r => r.rosterId === rosterId);
        return (row?.wins || 0) - (row?.losses || 0);
    };
    let rivalry = null;
    let smallestGap = Infinity;
    scoreboardWeek.filter(m => m.teams?.length === 2).forEach(m => {
        const [a, b] = m.teams;
        const gap = Math.abs(recordOf(a.roster_id) - recordOf(b.roster_id));
        if (gap < smallestGap) {
            smallestGap = gap;
            rivalry = { teamA: teamNameForYahoo(a.roster_id, standingsRows), teamB: teamNameForYahoo(b.roster_id, standingsRows), recordGap: gap };
        }
    });

    const starterPerf = [];
    Object.entries(rosterPlayersByTeamKey).forEach(([teamKey, rows]) => {
        const rosterId = standingsRows.find(r => r.teamKey === teamKey)?.rosterId ?? null;
        const teamName = rosterId != null ? teamNameForYahoo(rosterId, standingsRows) : teamKey;
        rows.filter(r => r.isStarter).forEach(r => starterPerf.push({ ...r, team: teamName }));
    });

    const mvpByPosition = {};
    POSITIONS.forEach(pos => {
        const atPos = starterPerf.filter(p => p.position === pos);
        if (atPos.length) mvpByPosition[pos] = [...atPos].sort((a, b) => b.actual - a.actual)[0];
    });

    const teamVariances = scoreboardWeek
        .flatMap(m => m.teams || [])
        .filter(t => t.projected_points != null)
        .map(t => ({
            team: teamNameForYahoo(t.roster_id, standingsRows),
            actual: t.points,
            projected: t.projected_points,
            variance: Math.round((t.points - t.projected_points) * 100) / 100,
        }));
    const biggestDisappointment = teamVariances.length
        ? [...teamVariances].sort((a, b) => a.variance - b.variance)[0]
        : null;

    const nameForPlayer = (playerId) => playerMeta[playerId] ? `${playerMeta[playerId].fn} ${playerMeta[playerId].ln}`.trim() : `Player #${playerId}`;
    const waiverMoves = transactions.filter(t => t.type === 'waiver' || t.type === 'free_agent');
    const trades = transactions.filter(t => t.type === 'trade');
    const transactionSummary = {
        waiverCount: waiverMoves.length,
        tradeCount: trades.length,
        notableAdds: waiverMoves.slice(0, 10).map(t => ({
            team: teamNameForYahoo((t.roster_ids || [])[0], standingsRows),
            added: Object.keys(t.adds || {}).map(nameForPlayer),
            faab: t.settings?.waiver_bid ?? null,
        })),
        trades: trades.slice(0, 10).map(t => ({
            teams: (t.roster_ids || []).map(rId => teamNameForYahoo(rId, standingsRows)),
            playersMoved: Object.keys(t.adds || {}).map(nameForPlayer),
        })),
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
- disappointmentOfTheWeek: Playfully roast the biggest disappointment (if one exists in the data) -- by player name if the data has one, otherwise by team name -- comparing the actual score to what was projected.
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

// --------------------------------------------------------------------------
// ESPN fetching. Self-contained rather than imported from api/espn-proxy.js
// (same no-cross-imports convention as the Yahoo section below) -- but
// unlike Yahoo, ESPN's own auth is just two stored cookies with no refresh
// flow, so there's no token cache/expiry logic needed here at all. A public
// league has no cookies stored at all and works fine without them; a
// private one with missing or expired cookies fails with a 401, surfaced
// as a per-league error in the results the same way any other failure is.
// --------------------------------------------------------------------------

const espnApiRequest = async (espnLeagueId, season, views, scoringPeriodId, cookies) => {
    const viewParams = views.map(v => `view=${v}`).join('&');
    const scoringPeriodParam = scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : '';
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}?${viewParams}${scoringPeriodParam}`;
    const headers = {};
    if (cookies?.espnS2 && cookies?.swid) {
        headers['Cookie'] = `espn_s2=${cookies.espnS2}; SWID=${cookies.swid};`;
    }
    const response = await fetch(url, { headers });
    if (response.status === 401) {
        throw new Error('Private ESPN league: missing or expired espn_s2/SWID cookies.');
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`ESPN API -> HTTP ${response.status}: ${body}`);
    }
    return response.json();
};

const getEspnCookies = async (userId) => {
    const { data } = await supabase
        .from('user_integrations')
        .select('access_token, refresh_token')
        .eq('user_id', userId)
        .eq('provider', 'espn')
        .maybeSingle();
    // No stored row just means a public league that was never given cookies --
    // proceed without them, same as api/espn-proxy.js does.
    return data ? { espnS2: data.access_token, swid: data.refresh_token } : {};
};

const generateForEspnLeague = async ({ leagueDbId, espnLeagueId, season, leagueName, week, userId }) => {
    const cookies = await getEspnCookies(userId);
    const data = await espnApiRequest(espnLeagueId, season, ['mTeam', 'mRoster', 'mMatchup', 'mTransactions2'], week, cookies);

    const { rosters, yahooPlayersMeta: playersMeta } = parseEspnLeagueRosters(data, { week, resolvedSwid: null });
    const byWeek = parseEspnSchedule(data.schedule);
    const transactions = parseEspnTransactions(data.transactions);

    // The transaction feed carries a bare player id, not a name -- current
    // rosters cover most of them, but a player dropped earlier and rostered
    // by nobody right now needs a best-effort name from ESPN's public
    // (cookie-free) athlete lookup, the same fallback fetchESPNTransactions
    // already uses client-side.
    const weekPlayerIds = new Set(
        transactions.filter(t => t.leg === week).flatMap(t => [...Object.keys(t.adds || {}), ...Object.keys(t.drops || {})])
    );
    for (const id of weekPlayerIds) {
        if (playersMeta[id]) continue;
        const defenseMeta = espnDefenseMetaFromId(id);
        if (defenseMeta) { playersMeta[id] = defenseMeta; continue; }
        try {
            const res = await fetch(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}`);
            if (res.ok) {
                const meta = parseEspnAthleteResponse(await res.json());
                if (meta) playersMeta[id] = meta;
            }
        } catch {
            // Best-effort -- this player just stays unresolved, same as the
            // client-side fallback degrades when ESPN's public API doesn't answer.
        }
    }

    const inputs = buildEspnStatsInputs({ byWeek, week, rosters, playersMeta, transactions });
    const stats = computeWeekStats(inputs);

    const narrative = await generateNarrative(leagueName, stats);
    narrative.week = week;

    return { leagueDbId, season: String(season), week, stats, narrative };
};

// --------------------------------------------------------------------------
// Yahoo OAuth + fetching. Self-contained rather than imported from
// api/yahoo-proxy.js -- this codebase's api/*.js files don't import each
// other, each is its own deployed function -- but the token cache/refresh
// logic below is otherwise the same as that file's getAccessToken, since
// Yahoo's per-user OAuth already works there.
// --------------------------------------------------------------------------

const yahooTokenCache = new Map();
const YAHOO_EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

const getYahooAccessToken = async (userId) => {
    const cached = yahooTokenCache.get(userId);
    if (cached && Date.now() < cached.expiresAtMs - YAHOO_EXPIRY_SAFETY_MARGIN_MS) {
        return cached.accessToken;
    }

    const { data: authData, error: authError } = await supabase
        .from('user_integrations')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'yahoo')
        .single();
    if (authError || !authData) {
        throw new Error('Yahoo account not linked for this user.');
    }

    let accessToken = authData.access_token;
    let expiresAtMs = new Date(authData.expires_at).getTime();

    if (Date.now() >= expiresAtMs - YAHOO_EXPIRY_SAFETY_MARGIN_MS) {
        const credentials = Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64');
        const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
            method: 'POST',
            headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                redirect_uri: process.env.YAHOO_REDIRECT_URI,
                refresh_token: authData.refresh_token,
            }),
        });
        if (!tokenResponse.ok) {
            const errBody = await tokenResponse.text().catch(() => '');
            throw new Error(`Yahoo token refresh failed (HTTP ${tokenResponse.status}): ${errBody}`);
        }
        const tokenData = await tokenResponse.json();
        accessToken = tokenData.access_token;
        expiresAtMs = Date.now() + tokenData.expires_in * 1000;

        await supabase.from('user_integrations').update({
            access_token: accessToken,
            refresh_token: tokenData.refresh_token,
            expires_at: new Date(expiresAtMs).toISOString(),
        }).eq('user_id', userId).eq('provider', 'yahoo');
    }

    yahooTokenCache.set(userId, { accessToken, expiresAtMs });
    return accessToken;
};

const yahooApiRequest = async (accessToken, endpoint) => {
    const response = await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/${endpoint}?format=json`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Yahoo API ${endpoint} -> HTTP ${response.status}: ${body}`);
    }
    return response.json();
};

const YAHOO_PLAYER_KEY_BATCH = 25;

const generateForYahooLeague = async ({ leagueDbId, yahooLeagueKey, leagueName, week, userId }) => {
    const accessToken = await getYahooAccessToken(userId);

    const [settingsData, scoreboardData, standingsData, transactionsData] = await Promise.all([
        yahooApiRequest(accessToken, `league/${yahooLeagueKey}/settings`),
        yahooApiRequest(accessToken, `league/${yahooLeagueKey}/scoreboard;week=${week}`),
        yahooApiRequest(accessToken, `league/${yahooLeagueKey}/standings`),
        yahooApiRequest(accessToken, `league/${yahooLeagueKey}/transactions`),
    ]);

    const leagueData = settingsData?.fantasy_content?.league?.[0];
    const season = String(leagueData?.season || new Date().getFullYear());
    const seasonStartMs = leagueData?.start_date ? Date.parse(`${leagueData.start_date}T00:00:00Z`) : null;
    const startWeek = parseInt(leagueData?.start_week) || 1;

    const standingsRows = parseYahooStandings(standingsData);
    const scoreboardWeek = parseYahooScoreboard(scoreboardData, week);

    const weekTransactions = parseYahooTransactions(transactionsData)
        .filter(t => weekFromTimestamp(t.status_updated, seasonStartMs, startWeek) === week);

    const playerKeys = [...new Set(weekTransactions.flatMap(t => t.player_keys || []))];
    const playerMeta = {};
    for (let i = 0; i < playerKeys.length; i += YAHOO_PLAYER_KEY_BATCH) {
        const group = playerKeys.slice(i, i + YAHOO_PLAYER_KEY_BATCH);
        const data = await yahooApiRequest(accessToken, `league/${yahooLeagueKey}/players;player_keys=${group.join(',')}`);
        parseYahooPlayers(data).forEach(p => { playerMeta[p.id] = p; });
    }

    const teamKeys = [...new Set(scoreboardWeek.flatMap(m => (m.teams || []).map(t => t.team_key)).filter(Boolean))];
    let rosterPlayersByTeamKey = {};
    if (teamKeys.length) {
        const rosterData = await yahooApiRequest(
            accessToken,
            `teams;team_keys=${teamKeys.join(',')}/roster;week=${week}/players/stats;type=week;week=${week}`
        );
        rosterPlayersByTeamKey = extractYahooRosterPlayers(rosterData);
    }

    const stats = computeYahooWeekStats({ scoreboardWeek, standingsRows, transactions: weekTransactions, rosterPlayersByTeamKey, playerMeta, week });

    const narrative = await generateNarrative(leagueName, stats);
    narrative.week = week;

    return { leagueDbId, season, week, stats, narrative };
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

    // Soft-launch allowlist: while this is being validated against a real
    // week before opening it up to every Pro subscriber, set this to a
    // comma-separated list of emails (e.g. just your own) in Vercel and only
    // leagues where an ALLOWED email is the Pro member get processed or
    // emailed -- everyone else's Pro status is ignored entirely for now, not
    // just skipped for email. Going public later is exactly one step:
    // delete this env var. Unset (the default), every Pro member of every
    // supported-platform league is processed, same as before this existed.
    const allowedEmails = (process.env.WEEKLY_SUMMARY_ALLOWED_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

    try {
        const { data: memberships, error: memErr } = await supabase
            .from('user_leagues')
            .select('league_id, user_id, leagues!inner(id, sleeper_league_id, platform, league_name, season), profiles!inner(is_premium, email)');
        if (memErr) throw memErr;

        const proLeagues = new Map();
        (memberships || []).forEach(row => {
            const league = row.leagues;
            const profile = row.profiles;
            if (!league || !['sleeper', 'yahoo', 'espn'].includes(league.platform)) return;
            if (onlyLeagueId && league.id !== onlyLeagueId) return;
            if (!profile?.is_premium || !profile?.email) return;
            if (allowedEmails.length && !allowedEmails.includes(profile.email.trim().toLowerCase())) return;

            if (!proLeagues.has(league.id)) {
                // userId is only used for the Yahoo and ESPN paths (fetching
                // a token / stored cookies to read the league with) -- both
                // platforms' league data is shared league-wide, so any Pro
                // member's linked account works, and the first one seen is
                // as good as any other.
                proLeagues.set(league.id, { league, emails: new Set(), userId: row.user_id });
            }
            proLeagues.get(league.id).emails.add(profile.email);
        });

        if (proLeagues.size === 0) {
            return res.status(200).json({
                processed: 0,
                allowlistActive: allowedEmails.length > 0,
                message: allowedEmails.length
                    ? `No league found where one of the allowed emails (${allowedEmails.join(', ')}) is a Pro member.`
                    : 'No leagues with a Pro member found.',
            });
        }

        const needsSleeper = [...proLeagues.values()].some(({ league }) => league.platform === 'sleeper');
        const playersCache = needsSleeper ? await fetchJson('https://api.sleeper.app/v1/players/nfl') : null;
        const projectionsCache = new Map();

        const results = [];
        for (const { league, emails, userId } of proLeagues.values()) {
            try {
                let week = weekOverride;
                if (!week) {
                    // NFL's own schedule pointer -- platform-agnostic, so
                    // it's the shared source of "what week is it" across
                    // Sleeper, Yahoo, and ESPN leagues alike.
                    const nflState = await fetchJson('https://api.sleeper.app/v1/state/nfl');
                    const currentWeek = nflState.week || nflState.display_week || 1;
                    // "The week that just finished" -- by the time this cron
                    // fires (Tuesday), the current-week pointer has
                    // typically already rolled forward to the upcoming week.
                    week = Math.max(1, currentWeek - 1);
                }

                const generated = league.platform === 'yahoo'
                    ? await generateForYahooLeague({
                        leagueDbId: league.id,
                        yahooLeagueKey: league.sleeper_league_id,
                        leagueName: league.league_name || 'Your League',
                        week,
                        userId,
                    })
                    : league.platform === 'espn'
                    ? await generateForEspnLeague({
                        leagueDbId: league.id,
                        espnLeagueId: fromEspnLeagueId(league.sleeper_league_id),
                        season: league.season,
                        leagueName: league.league_name || 'Your League',
                        week,
                        userId,
                    })
                    : await generateForLeague({
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

        return res.status(200).json({ processed: results.length, dryRun, allowlistActive: allowedEmails.length > 0, results });
    } catch (error) {
        console.error('weekly-summary handler error:', error);
        return res.status(500).json({ error: error.toString() });
    }
}
