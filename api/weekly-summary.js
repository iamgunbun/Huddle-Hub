// api/weekly-summary.js
//
// The Pro "Weekly Summary" feature: every Tuesday (see vercel.json's cron
// entry), this generates one recap per Sleeper, Yahoo, or ESPN league that
// has at least one Pro member, and stores it (league_weekly_summaries --
// read by src/pages/WeeklySummary.jsx). The full recap only ever lives in
// the app: each Pro member gets ONE short "your recaps are ready" digest
// email afterward (buildDigestEmailHtml/sendDigestEmail below), listing
// every league of theirs that's ready with a button straight into each --
// not one full-recap email per league, which is what a member in several
// leagues used to get flooded with every Tuesday.
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
// "Biggest disappointment" is a TEAM there too, not one player -- a whole
// roster no-showing roasts better than singling someone out -- which is
// also all Yahoo ever had to work with (it publishes no per-player
// projection through its API, only a per-team one). Yahoo's roster/points
// data still arrives in a genuinely different shape than Sleeper's/ESPN's
// though (a separate scoreboard-vs-roster fetch, selected_position-based
// starter filtering), so it keeps its own pipeline (computeYahooWeekStats
// below) rather than being reshaped into computeWeekStats too. Gemini is
// only ever handed those already-verified facts and asked to narrate them
// -- the same "give it real facts, let it write flavor" split
// api/evaluate.js's manager report already uses -- specifically so it
// cannot invent a score, a name, or a stat that didn't happen.
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

export const teamNameFor = (rosterId, rosters, users) => {
    const roster = rosters.find(r => r.roster_id === rosterId);
    const user = users.find(u => u.user_id === roster?.owner_id);
    return user?.metadata?.team_name || user?.display_name || `Team ${rosterId}`;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// --------------------------------------------------------------------------
// The league-wide eval. Every function below is pure and platform-neutral:
// each pipeline normalises its own data into these shapes, so Sleeper,
// Yahoo and ESPN all produce the same eval rather than three variants of
// one. All of it is computed from real scores -- none of it is anything
// Gemini is left to estimate.
// --------------------------------------------------------------------------

/** Every result this week, ranked by the winning score. */
export const buildScoreboard = (games) => {
    return [...games]
        .sort((a, b) => Math.max(b.scoreA, b.scoreB) - Math.max(a.scoreA, a.scoreB))
        .map(g => ({
            winner: g.winner,
            loser: g.winner ? (g.winner === g.teamA ? g.teamB : g.teamA) : null,
            winnerScore: g.winner === g.teamB ? g.scoreB : g.scoreA,
            loserScore: g.winner === g.teamB ? g.scoreA : g.scoreB,
            margin: g.margin,
            tie: !g.winner,
        }));
};

/** How this week scored league-wide -- the yardstick every team is judged against. */
export const buildScoringContext = (teamScores) => {
    const scores = teamScores.filter(t => Number.isFinite(t.score));
    if (!scores.length) return null;
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    const total = sorted.reduce((sum, t) => sum + t.score, 0);
    const mid = Math.floor(sorted.length / 2);
    return {
        average: round2(total / sorted.length),
        median: round2(sorted.length % 2 ? sorted[mid].score : (sorted[mid - 1].score + sorted[mid].score) / 2),
        highest: { team: sorted[0].team, score: round2(sorted[0].score) },
        lowest: { team: sorted[sorted.length - 1].team, score: round2(sorted[sorted.length - 1].score) },
        allScores: sorted.map(t => ({ team: t.team, score: round2(t.score) })),
    };
};

/** Standings after this week -- record first, points scored as the tiebreak. */
export const buildPowerRankings = (teamRecords) => {
    return [...teamRecords]
        .sort((a, b) => {
            const winDiff = (b.wins - b.losses) - (a.wins - a.losses);
            if (winDiff !== 0) return winDiff;
            return (b.pointsFor || 0) - (a.pointsFor || 0);
        })
        .map((t, idx) => ({
            rank: idx + 1,
            team: t.team,
            wins: t.wins,
            losses: t.losses,
            pointsFor: round2(t.pointsFor || 0),
        }));
};

/**
 * The worst start/sit call each team made: the bench player who outscored
 * one of that team's own starters AT THE SAME POSITION by the most. Same
 * position matters -- a benched QB outscoring a starting kicker is not a
 * decision anyone actually got to make, and calling it one would be a roast
 * built on a fake mistake.
 *
 * Returned worst-first, since the point of this is the league-wide "who
 * blew it hardest this week" line.
 */
export const buildBenchCalls = (teamRosters) => {
    const calls = [];

    teamRosters.forEach(({ team, players: roster }) => {
        const starters = (roster || []).filter(p => p.isStarter && p.position);
        const bench = (roster || []).filter(p => !p.isStarter && p.position);
        let worst = null;

        bench.forEach(benched => {
            starters
                .filter(s => s.position === benched.position)
                .forEach(started => {
                    const pointsLeft = round2(benched.actual - started.actual);
                    if (pointsLeft <= 0) return;
                    if (!worst || pointsLeft > worst.pointsLeft) {
                        worst = {
                            team,
                            position: benched.position,
                            benched: benched.name,
                            benchedPoints: round2(benched.actual),
                            started: started.name,
                            startedPoints: round2(started.actual),
                            pointsLeft,
                        };
                    }
                });
        });

        if (worst) calls.push(worst);
    });

    return calls.sort((a, b) => b.pointsLeft - a.pointsLeft);
};

/**
 * Who the schedule carried and who it robbed: the lowest score that still
 * won, and the highest score that still lost. Both are only interesting
 * relative to the rest of the week, so they carry the league average with
 * them.
 */
export const buildLuckWatch = (scoreboard, leagueAverage) => {
    const decided = scoreboard.filter(g => !g.tie);
    if (!decided.length) return null;

    const luckiest = [...decided].sort((a, b) => a.winnerScore - b.winnerScore)[0];
    const unluckiest = [...decided].sort((a, b) => b.loserScore - a.loserScore)[0];

    return {
        luckiestWin: {
            team: luckiest.winner,
            score: round2(luckiest.winnerScore),
            beat: luckiest.loser,
            opponentScore: round2(luckiest.loserScore),
            vsLeagueAverage: round2(luckiest.winnerScore - leagueAverage),
        },
        unluckiestLoss: {
            team: unluckiest.loser,
            score: round2(unluckiest.loserScore),
            lostTo: unluckiest.winner,
            opponentScore: round2(unluckiest.winnerScore),
            vsLeagueAverage: round2(unluckiest.loserScore - leagueAverage),
        },
    };
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

    // Biggest disappointment is a TEAM'S shortfall against its own
    // projected total (the sum of its starters' individual projections),
    // not one player's -- roasting "your whole roster no-showed" reads
    // funnier than singling out one guy, and it's what puts Sleeper/ESPN on
    // the same footing as Yahoo, which only ever had a team-level number to
    // work with in the first place (see computeYahooWeekStats below).
    const teamVariances = matchups.map(m => {
        const projectedTotal = (m.starters || []).reduce((sum, pid) => sum + (projById[pid] ?? 0), 0);
        return {
            team: teamNameFor(m.roster_id, rosters, users),
            actual: Math.round((m.points || 0) * 100) / 100,
            projected: Math.round(projectedTotal * 100) / 100,
            variance: Math.round(((m.points || 0) - projectedTotal) * 100) / 100,
        };
    }).filter(t => t.projected > 0);
    const biggestDisappointment = teamVariances.length
        ? [...teamVariances].sort((a, b) => a.variance - b.variance)[0]
        : null;

    // Whether an added player actually started and produced this same week
    // -- drawn from starterPerf, already computed above, so "impact" is a
    // real number this league's own data backs up rather than something
    // Gemini has to invent or guess at from just a name.
    const actualById = {};
    starterPerf.forEach(p => { actualById[p.playerId] = p.actual; });

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
                added: addedIds.map(id => ({
                    name: players[id] ? `${players[id].first_name} ${players[id].last_name}`.trim() : `Player #${id}`,
                    // null means they didn't start this week (or there's no
                    // data yet) -- not zero, which would misread as "started
                    // and scored nothing."
                    pointsThisWeek: actualById[id] ?? null,
                })),
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

    // --- The league-wide eval, off the same already-verified numbers ---
    const teamScores = matchups.map(m => ({
        team: teamNameFor(m.roster_id, rosters, users),
        score: m.points || 0,
    }));
    const scoreboard = buildScoreboard(games);
    const scoringContext = buildScoringContext(teamScores);
    const powerRankings = buildPowerRankings(rosters.map(r => ({
        team: teamNameFor(r.roster_id, rosters, users),
        wins: r.settings?.wins || 0,
        losses: r.settings?.losses || 0,
        pointsFor: r.settings?.fpts || 0,
    })));
    // Sleeper hands back every rostered player and their points alongside
    // the starters, so the bench is already here -- no extra request needed
    // to work out what a manager left on it.
    const benchCalls = buildBenchCalls(matchups.map(m => {
        const starterIds = new Set((m.starters || []).filter(pid => pid && pid !== '0'));
        const pointsById = m.players_points || {};
        return {
            team: teamNameFor(m.roster_id, rosters, users),
            players: (m.players || [])
                .filter(Boolean)
                .map(pid => ({
                    name: players[pid] ? `${players[pid].first_name || ''} ${players[pid].last_name || ''}`.trim() : `Player #${pid}`,
                    position: players[pid]?.position || '',
                    actual: pointsById[pid] ?? 0,
                    isStarter: starterIds.has(pid),
                }))
                .filter(p => p.position),
        };
    }));
    const luckWatch = scoringContext ? buildLuckWatch(scoreboard, scoringContext.average) : null;

    return {
        week, games, blowout, closestCall, rivalry, mvpByPosition, biggestDisappointment,
        transactions: transactionSummary,
        scoreboard, scoringContext, powerRankings, benchCalls, luckWatch,
        teamVariances: teamVariances.sort((a, b) => b.variance - a.variance),
    };
};

/**
 * Real opponent pairings for a FUTURE week, off Sleeper's own matchups
 * response for that week -- Sleeper publishes the pairing (which roster_id
 * faces which) well before kickoff, just with zeroed-out scores, so this
 * is real schedule data, not a guess. Same matchup_id-pairing shape
 * computeWeekStats already groups above, reused here since it's the exact
 * same problem one week ahead.
 */
export const nextWeekMatchupPreview = (nextMatchups, rosters, users) => {
    const byMatchup = {};
    (nextMatchups || []).forEach(m => {
        if (!byMatchup[m.matchup_id]) byMatchup[m.matchup_id] = [];
        byMatchup[m.matchup_id].push(m);
    });
    return Object.values(byMatchup)
        .filter(pair => pair.length === 2)
        .map(([a, b]) => ({
            teamA: teamNameFor(a.roster_id, rosters, users),
            teamB: teamNameFor(b.roster_id, rosters, users),
        }));
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
            // players/players_points mirror Sleeper's own field names on
            // purpose: computeWeekStats reads the bench off those two, so
            // filling them here is what lets ESPN's start/sit calls come
            // out of the same shared code rather than a second version.
            const allPlayers = roster?.players || [];
            matchups.push({
                matchup_id: idx + 1,
                roster_id: t.roster_id,
                points: t.points || 0,
                starters,
                starters_points: starters.map(pid => playersMeta[pid]?.actualPoints ?? 0),
                players: allPlayers,
                players_points: Object.fromEntries(
                    allPlayers.map(pid => [pid, playersMeta[pid]?.actualPoints ?? 0])
                ),
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

/**
 * Same idea as nextWeekMatchupPreview above, off ESPN's shape instead --
 * byWeek already covers the whole season in one fetch (parseEspnSchedule),
 * so a future week's pairing is already sitting in memory, no extra
 * request needed.
 */
export const espnNextWeekMatchupPreview = (nextWeekPairs, rosters) => {
    return (nextWeekPairs || [])
        .filter(pair => pair?.length === 2)
        .map(([a, b]) => ({
            teamA: rosters[a.roster_id]?.team_name || `Team ${a.roster_id}`,
            teamB: rosters[b.roster_id]?.team_name || `Team ${b.roster_id}`,
        }));
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
 * A player's fantasy points out of a Yahoo player entity, wherever Yahoo
 * put them.
 *
 * Every OTHER field on this entity is read through yahooField, which
 * tolerates both of Yahoo's entity shapes; player_points was the one field
 * read by scanning only the player array's own top-level elements. That
 * misses it whenever the entity arrives in the numeric-key object form
 * (quirk 3 in yahooHistory.js's header: a node carrying both
 * sub-collections and scalars is keyed "0","1","2",... rather than being a
 * real array), and a miss silently reads as 0 rather than as an error --
 * which is exactly how every player in a Yahoo weekly summary ended up at
 * 0.0 while their names, positions and starter flags all read correctly
 * off that same entity.
 *
 * Walks both shapes, shallow-first, via the same yahooCollection helper
 * that already normalises array-vs-object everywhere else.
 */
/**
 * The league's own scoring, as { [statId]: pointsPerUnit }.
 *
 * Yahoo publishes this on the league settings response that this endpoint
 * already fetches, which makes player points derivable from raw stats
 * without another request -- see scoreYahooStatLine below for why that
 * matters.
 */
export const parseYahooStatModifiers = (settingsData) => {
    const league = settingsData?.fantasy_content?.league;
    const settings = findNode(league, 'settings');
    const modifiersNode = findNode(settings, 'stat_modifiers') || settings?.stat_modifiers;
    const statsNode = findNode(modifiersNode, 'stats') || modifiersNode?.stats;

    const modifiers = {};
    yahooCollection(statsNode).forEach(entry => {
        const stat = entry?.stat || entry;
        const statId = yahooText(yahooField(stat, 'stat_id'));
        const value = parseFloat(yahooText(yahooField(stat, 'value')));
        if (statId && Number.isFinite(value)) modifiers[statId] = value;
    });
    return modifiers;
};

/**
 * A player's fantasy points computed from their raw weekly stat line.
 *
 * Yahoo only returns a player_points node when the request carries league
 * context; the raw player_stats line comes back either way. Deriving the
 * total here means the points survive regardless of which shape the
 * response takes -- worth having as a fallback given how many times the
 * "why are these all zero" answer has turned out to be about the request
 * rather than the parsing.
 */
export const scoreYahooStatLine = (player, modifiers) => {
    if (!modifiers || !Object.keys(modifiers).length) return null;

    const statsNode = (() => {
        const seen = new Set();
        const walk = (node, depth) => {
            if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return null;
            seen.add(node);
            if (node.player_stats) return node.player_stats;
            for (const value of yahooCollection(node)) {
                const hit = walk(value, depth + 1);
                if (hit) return hit;
            }
            return null;
        };
        return walk(player, 0);
    })();

    const rows = yahooCollection(findNode(statsNode, 'stats') || statsNode?.stats);
    if (!rows.length) return null;

    let total = 0;
    let matched = 0;
    rows.forEach(entry => {
        const stat = entry?.stat || entry;
        const statId = yahooText(yahooField(stat, 'stat_id'));
        const raw = yahooText(yahooField(stat, 'value'));
        const value = parseFloat(raw);
        if (!statId || !Number.isFinite(value)) return;
        if (modifiers[statId] === undefined) return;
        total += value * modifiers[statId];
        matched += 1;
    });

    return matched ? Math.round(total * 100) / 100 : null;
};

export const findYahooPlayerPoints = (player) => {
    const seen = new Set();
    const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return null;
        seen.add(node);
        if (node.player_points && node.player_points.total !== undefined) return node.player_points;
        for (const value of yahooCollection(node)) {
            const hit = walk(value, depth + 1);
            if (hit) return hit;
        }
        return null;
    };
    return walk(player, 0);
};

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
export const extractYahooRosterPlayers = (data, statModifiers = null) => {
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

            // Yahoo's own total when it's there; otherwise derive it from
            // the raw stat line, which comes back either way. Only falls
            // through to 0 when the response carried neither.
            const pointsNode = findYahooPlayerPoints(player);
            const reportedTotal = pointsNode?.total !== undefined ? parseFloat(pointsNode.total) : null;
            const actual = Number.isFinite(reportedTotal)
                ? reportedTotal
                : (scoreYahooStatLine(player, statModifiers) ?? 0);

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
 * Yahoo's equivalent of computeWeekStats. biggestDisappointment is a team
 * here (Yahoo's own team-level points vs. team-level projected_points from
 * the scoreboard) the same way computeWeekStats' now is for Sleeper/ESPN --
 * Yahoo just never had a player-level projection to begin with, so this was
 * always the one platform this had to be true for. The real, Yahoo-specific
 * difference is starterPerf/mvpByPosition, which draws only from players
 * extractYahooRosterPlayers marked as started (selected_position outside
 * the bench/IR slots), since Yahoo's roster response includes the whole
 * bench too.
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

    // Same real-impact lookup as computeWeekStats above, off Yahoo's own
    // starterPerf (playerId keyed the same way transactions' adds are).
    const actualById = {};
    starterPerf.forEach(p => { actualById[p.playerId] = p.actual; });

    const waiverMoves = transactions.filter(t => t.type === 'waiver' || t.type === 'free_agent');
    const trades = transactions.filter(t => t.type === 'trade');
    const transactionSummary = {
        waiverCount: waiverMoves.length,
        tradeCount: trades.length,
        notableAdds: waiverMoves.slice(0, 10).map(t => ({
            team: teamNameForYahoo((t.roster_ids || [])[0], standingsRows),
            added: Object.keys(t.adds || {}).map(id => ({
                name: nameForPlayer(id),
                pointsThisWeek: actualById[id] ?? null,
            })),
            faab: t.settings?.waiver_bid ?? null,
        })),
        trades: trades.slice(0, 10).map(t => ({
            teams: (t.roster_ids || []).map(rId => teamNameForYahoo(rId, standingsRows)),
            playersMoved: Object.keys(t.adds || {}).map(nameForPlayer),
        })),
    };

    // --- The same league-wide eval Sleeper/ESPN get, off Yahoo's own data ---
    const teamScores = scoreboardWeek
        .flatMap(m => m.teams || [])
        .map(t => ({ team: teamNameForYahoo(t.roster_id, standingsRows), score: t.points || 0 }));
    const scoreboard = buildScoreboard(games);
    const scoringContext = buildScoringContext(teamScores);
    const powerRankings = buildPowerRankings(standingsRows.map(r => ({
        team: r.teamName,
        wins: r.wins || 0,
        losses: r.losses || 0,
        pointsFor: r.pointsFor || 0,
    })));
    // Yahoo's roster response already includes the whole bench with each
    // player's own isStarter flag, so the start/sit calls need no extra
    // request here either.
    const benchCalls = buildBenchCalls(Object.entries(rosterPlayersByTeamKey).map(([teamKey, rows]) => {
        const rosterId = standingsRows.find(r => r.teamKey === teamKey)?.rosterId ?? null;
        return {
            team: rosterId != null ? teamNameForYahoo(rosterId, standingsRows) : teamKey,
            players: rows,
        };
    }));
    const luckWatch = scoringContext ? buildLuckWatch(scoreboard, scoringContext.average) : null;

    return {
        week, games, blowout, closestCall, rivalry, mvpByPosition, biggestDisappointment,
        transactions: transactionSummary,
        scoreboard, scoringContext, powerRankings, benchCalls, luckWatch,
        teamVariances: teamVariances.sort((a, b) => b.variance - a.variance),
    };
};

/** Same idea again, off Yahoo's scoreboard shape. */
export const yahooNextWeekMatchupPreview = (nextScoreboardWeek, standingsRows) => {
    return (nextScoreboardWeek || [])
        .filter(m => m.teams?.length === 2)
        .map(m => ({
            teamA: teamNameForYahoo(m.teams[0].roster_id, standingsRows),
            teamB: teamNameForYahoo(m.teams[1].roster_id, standingsRows),
        }));
};

/**
 * The slice of the stats the narrative actually needs, compact.
 *
 * The whole stats object pretty-printed is a large prompt -- `games`
 * duplicates `scoreboard`, `allScores` duplicates the rankings, and
 * `teamVariances` carries a row per team that only the disappointment line
 * uses. Sending all of it is what pushed generation past its deadline on
 * real multi-team leagues (three leagues in one run failed with "Gemini
 * narrative exceeded 60000ms" and so produced no recap at all). Trimmed to
 * what each section is actually told to read, and stringified without
 * indentation.
 */
export const narrativePayload = (stats) => ({
    week: stats.week,
    scoreboard: stats.scoreboard,
    scoringContext: stats.scoringContext && {
        average: stats.scoringContext.average,
        median: stats.scoringContext.median,
        highest: stats.scoringContext.highest,
        lowest: stats.scoringContext.lowest,
    },
    powerRankings: stats.powerRankings,
    // Only the worst few are ever named; the rest is noise in the prompt.
    benchCalls: (stats.benchCalls || []).slice(0, 4),
    luckWatch: stats.luckWatch,
    mvpByPosition: stats.mvpByPosition,
    biggestDisappointment: stats.biggestDisappointment,
    rivalry: stats.rivalry,
    transactions: stats.transactions,
    nextWeekMatchups: stats.nextWeekMatchups,
});

const buildNarrativePrompt = (leagueName, stats) => `You are writing a fun, banter-filled weekly recap email for the fantasy football league "${leagueName}", covering Week ${stats.week}. This goes out to every manager in the league, so the tone should read like a knowledgeable, slightly cheeky league commissioner's newsletter -- not a generic sports report.

CRITICAL GROUNDING RULE: Every fact, score, name, and number below is real and verified. You must ONLY reference what's in this data. Never invent a score, a player, a team name, or a stat that isn't listed here.

THIS WEEK'S DATA:
${JSON.stringify(narrativePayload(stats))}

TONE: You are the league's loudmouth commissioner. Be genuinely funny and mean-spirited in a way friends are with each other -- name names, use the real numbers as ammunition, and never hedge into bland sports-desk filler. A manager reading this should either laugh or want to fight you. Roast hard, but only ever with facts that are actually in the data below.

Write a recap with these sections. Each should be 2-4 sentences (the roast sections can run longer), punchy and specific -- use the real names and numbers, never be generic:
- headline: A punchy 5-10 word headline for the week.
- matchupRecap: Walk the whole week, not just two games. stats.scoreboard lists every result ranked by winning score -- reference several by name and score, and use stats.scoringContext (league average/median, the week's highest and lowest scores) to say whether this was a shootout week or a leaguewide faceplant.
- mvpSpotlight: Call out the standout position MVPs (the highest scorer at each position) by name and points.
- disappointmentOfTheWeek: Roast the biggest disappointment (if one exists in the data) -- it's always a TEAM, not a player, so go after the whole roster/manager, not one guy. Really lean into it: compare their actual score to what they were projected for and let them have it.
- benchDisasters: The week's worst start/sit calls, from stats.benchCalls (already sorted worst-first). Each entry is a real decision a manager actually made: they benched \`benched\` (\`benchedPoints\` pts) and started \`started\` (\`startedPoints\` pts) at the SAME position, leaving \`pointsLeft\` on the bench. Lead with the single worst one and absolutely bury that manager for it by name, then mention one or two others. If stats.benchCalls is empty, say every manager somehow got their lineup right and sound suspicious about it.
- powerRankings: Using stats.powerRankings (already ranked, with real records and points-for), give a quick rundown -- who's for real at the top, who's quietly climbing, and who at the bottom should consider a new hobby. Name at least the top team and the bottom team with their actual records.
- luckWatch: From stats.luckWatch. luckiestWin is the lowest score that still won (say how far below the league average it was and who they got to beat), and unluckiestLoss is the highest score that still lost (sympathy optional, mockery encouraged). Skip gracefully if it's missing.
- rivalryWatch: Frame this week's most evenly-matched-by-record matchup as a rivalry, if one exists in the data.
- waiverWireBuzz: Analyze the week's trades and waiver activity, not just list it. For each notable add, transactions.notableAdds[].added[] carries pointsThisWeek -- a real number if that player actually started and scored for their new team this week, or null if they didn't start. Grade the move on that: a pickup that started and scored well is a smart, real-impact add worth praising by name and points; one that sat the bench or scored little is fair game to call out as premature or a stash. Never invent a point total that isn't in the data, and never claim "impact" for a null pointsThisWeek -- say they haven't started yet instead.
- fullEvaluation: The long one -- a complete written evaluation of the entire league week, 3-5 paragraphs, separated by blank lines. Go team by team through stats.powerRankings and account for EVERY team: what they scored, whether they won or lost and to whom, how that squares with their record, and what it says about them. Work in the bench blunders, the waiver moves, the luck, and who is genuinely good versus who is being carried by an easy schedule. This is the definitive summary of the week -- thorough, specific, and still openly mocking. Only real names and numbers from the data.
- storyBurns: REQUIRED, and every single key below must be present and non-empty -- these are the one-liners on the full-screen story cards, and a card without one falls flat. Each card already shows the team name and the number, so your line is the BURN that goes under it, NOT a restatement of the fact. ONE sentence, max ~15 words, and it must be a genuine insult -- snarky, personal, the kind of thing that starts an argument in the group chat. No hedging, no "tough break", no neutral observations. If a card's underlying data happens to be missing, still write a snarky line aimed at the league in general rather than leaving it blank. The keys:
  - highScore: for stats.scoringContext.highest -- credit where it's due, but keep it backhanded.
  - blowout: for stats.blowout -- the winner beat a specific opponent; go after the loser for showing up at all.
  - closestCall: for stats.closestCall -- a win this narrow is nothing to brag about.
  - mvps: for stats.mvpByPosition -- one line about the week's best performers.
  - benchDisaster: for stats.benchCalls[0] -- this manager benched a specific player for a specific worse one. Be merciless and name them.
  - disappointment: for stats.biggestDisappointment -- they were projected for more and did not come close.
  - luck: for stats.luckWatch.unluckiestLoss -- they scored well and lost anyway.
  - powerRankings: for the TOP of stats.powerRankings -- this card is "This Week's Leaders" and shows the teams at the top of the standings. Give them credit and then undercut it; never sound impressed.
  - bottomFeeders: for the BOTTOM of stats.powerRankings -- this card is literally titled "Bottom Feeders" and lists the worst teams in the league by record. Name them and bury them; this is the meanest line on the whole run.
- nextWeekPreview: Only write this if stats.nextWeekMatchups is present and non-empty -- if it's missing or empty, return an empty string, don't guess at next week. When present, preview 1-2 of next week's real matchups by the real team names listed there -- which pairing looks like the week's best game, purely based on this week's results/records already in the data. Never invent an opponent, a projection, or a score for a game that hasn't happened.

If a section's underlying data is empty or missing (e.g. no trades happened, or no disappointment qualified), say so briefly and move on -- never fabricate content to fill a section.`;

export const NARRATIVE_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        headline: { type: SchemaType.STRING },
        matchupRecap: { type: SchemaType.STRING },
        mvpSpotlight: { type: SchemaType.STRING },
        disappointmentOfTheWeek: { type: SchemaType.STRING },
        benchDisasters: { type: SchemaType.STRING },
        powerRankings: { type: SchemaType.STRING },
        luckWatch: { type: SchemaType.STRING },
        rivalryWatch: { type: SchemaType.STRING },
        waiverWireBuzz: { type: SchemaType.STRING },
        nextWeekPreview: { type: SchemaType.STRING },
        fullEvaluation: { type: SchemaType.STRING },
        // Every key REQUIRED. Left optional, the model simply omitted the
        // whole object and every story card rendered with no burn at all,
        // which is exactly the "there are still no roasts" report. A card
        // with no data gets a general jab rather than being skipped.
        storyBurns: {
            type: SchemaType.OBJECT,
            properties: {
                highScore: { type: SchemaType.STRING },
                blowout: { type: SchemaType.STRING },
                closestCall: { type: SchemaType.STRING },
                mvps: { type: SchemaType.STRING },
                benchDisaster: { type: SchemaType.STRING },
                disappointment: { type: SchemaType.STRING },
                luck: { type: SchemaType.STRING },
                powerRankings: { type: SchemaType.STRING },
                bottomFeeders: { type: SchemaType.STRING },
            },
            required: [
                'highScore', 'blowout', 'closestCall', 'mvps',
                'benchDisaster', 'disappointment', 'luck', 'powerRankings',
                'bottomFeeders',
            ],
        },
    },
    required: [
        'headline', 'matchupRecap', 'mvpSpotlight', 'disappointmentOfTheWeek',
        'benchDisasters', 'powerRankings', 'luckWatch',
        'rivalryWatch', 'waiverWireBuzz', 'nextWeekPreview',
        'fullEvaluation', 'storyBurns',
    ],
};

/**
 * Every computed stat still renders without a narrative -- the scoreboard,
 * MVPs, bench calls and standings are all real numbers this endpoint
 * already has in hand. Losing the whole recap because the AI step was slow
 * (three leagues in one run died on "Gemini narrative exceeded 60000ms",
 * and a thrown error meant nothing was written at all) is far worse than
 * showing those numbers with a plain header over them, so generation
 * failure degrades to this instead of taking the league down.
 */
const fallbackNarrative = (week, reason) => ({
    headline: `Week ${week} Recap`,
    matchupRecap: '',
    mvpSpotlight: '',
    disappointmentOfTheWeek: '',
    benchDisasters: '',
    powerRankings: '',
    luckWatch: '',
    rivalryWatch: '',
    waiverWireBuzz: '',
    nextWeekPreview: '',
    fullEvaluation: '',
    storyBurns: {},
    generationFailed: reason || true,
});

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
    // The single slowest step in a league, and the SDK enforces no timeout
    // of its own -- one slow generation used to be enough to push the whole
    // multi-league run past the platform's ceiling.
    const result = await withDeadline(
        model.generateContent(buildNarrativePrompt(leagueName, stats)),
        GEMINI_TIMEOUT_MS,
        `Gemini narrative for "${leagueName}"`
    );
    if (!result.response.candidates || result.response.candidates.length === 0) {
        throw new Error('Gemini blocked the weekly summary response.');
    }
    return JSON.parse(result.response.text());
};

const escapeHtml = (str) => String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const APP_URL = 'https://huddleff.app';

// One email per RECIPIENT, not per league -- a Pro member in several
// leagues used to get one full-recap email per league, every Tuesday. This
// is a short "your recaps are ready" notice with one button per league
// (linking straight to that league's recap -- see the ?league= handling in
// WeeklySummary.jsx) instead, however many leagues that person is Pro in.
// The full narrative only ever lives in the app.
export const buildDigestEmailHtml = (leagues) => {
    const rows = leagues.map(l => `
        <tr><td style="padding: 16px 0; border-bottom: 1px solid #eee;">
            <div style="font-weight: 700; font-size: 14px; color: #111; margin-bottom: 2px;">${escapeHtml(l.leagueName)}</div>
            <div style="font-size: 13px; color: #666; line-height: 1.5; margin-bottom: 10px;">${escapeHtml(l.headline)}</div>
            <a href="${APP_URL}/weekly-summary?league=${encodeURIComponent(l.leagueId)}" style="display: inline-block; padding: 10px 22px; background: #eebf1c; color: #111; text-decoration: none; font-weight: 700; font-size: 13px; border-radius: 8px;">View Summary</a>
        </td></tr>`).join('');

    return `
    <div style="background:#0b0f16; padding: 32px 16px; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;">
            <tr>
                <td style="background: #111318; padding: 28px 32px; text-align: center;">
                    <img src="${APP_URL}/mobile.png" alt="Huddle" width="64" height="64" style="display:block; margin: 0 auto 8px;" />
                    <div style="color: #eebf1c; font-weight: 800; letter-spacing: 1px; font-size: 14px;">HUDDLE WEEKLY SUMMARY</div>
                </td>
            </tr>
            <tr>
                <td style="padding: 28px 32px 8px;">
                    <h1 style="margin: 0 0 4px; font-size: 20px; color: #111;">${leagues.length === 1 ? 'Your Weekly Summary Is Ready' : 'Your Weekly Summaries Are Ready'}</h1>
                    <p style="margin: 0 0 8px; font-size: 13px; color: #888;">${leagues.length} league${leagues.length === 1 ? '' : 's'} recapped -- tap in to see the damage.</p>
                </td>
            </tr>
            <tr><td style="padding: 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rows}
            </table></td></tr>
            <tr>
                <td style="padding: 20px 32px; background: #f7f7f8; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #888;">
                        You're getting this because you're a Huddle Pro subscriber.
                        Manage your subscription in <a href="${APP_URL}/account" style="color: #888;">Account Settings</a>.
                    </p>
                </td>
            </tr>
        </table>
    </div>`;
};

const sendDigestEmail = async (email, leagues) => {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        console.error('Resend is not configured -- skipping weekly summary digest email.');
        return { sent: false, reason: 'not_configured' };
    }
    const week = leagues[0]?.week;
    const subject = leagues.length === 1
        ? `${leagues[0].leagueName} Week ${week ?? ''} Recap Is Ready`
        : `Your Week ${week ?? ''} Weekly Summaries Are Ready (${leagues.length} leagues)`;
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: email,
            subject,
            html: buildDigestEmailHtml(leagues),
        }),
    });
    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        console.error('Weekly summary digest email failed:', errBody);
        return { sent: false, reason: 'send_failed' };
    }
    return { sent: true };
};

// No outbound call here had a timeout, and fetch has no default one: a
// single platform or Gemini request that never answers blocks its league
// forever, which is what made this endpoint die on Vercel's hard 300s
// ceiling (FUNCTION_INVOCATION_TIMEOUT) rather than finishing short. Every
// request below now fails fast instead, so one bad upstream costs that
// league and nothing else.
const REQUEST_TIMEOUT_MS = 20000;
// Generation is slower than a plain API read, so it gets its own, longer
// ceiling -- still bounded, which is the point.
const GEMINI_TIMEOUT_MS = 60000;
// The whole of one league: its platform fetches plus its narrative. A
// league that can't finish inside this is reported as a failure for that
// league rather than being allowed to consume the run's entire budget.
const LEAGUE_TIMEOUT_MS = 110000;

export const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error(`${url} -> timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
};

/** Rejects if `promise` hasn't settled in time, so one stuck step can't hold a whole run. */
export const withDeadline = (promise, timeoutMs, label) => {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
        }),
    ]).finally(() => clearTimeout(timer));
};

const fetchJson = async (url, options) => {
    const res = await fetchWithTimeout(url, options);
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

    // Best-effort -- next week's pairing not being available yet (e.g. the
    // very last week of the regular season) just means no preview section,
    // never a failed recap over it.
    const nextWeekMatchups = await fetchJson(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/matchups/${week + 1}`)
        .then(m => nextWeekMatchupPreview(Array.isArray(m) ? m : [], Array.isArray(rosters) ? rosters : [], Array.isArray(users) ? users : []))
        .catch(() => []);
    if (nextWeekMatchups.length) stats.nextWeekMatchups = nextWeekMatchups;

    const narrative = await generateNarrative(leagueName, stats)
        .catch((err) => {
            console.error(`Narrative generation failed for "${leagueName}" -- saving the stats without it:`, err.message);
            return fallbackNarrative(week, err.message);
        });
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
    const response = await fetchWithTimeout(url, { headers });
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
            const res = await fetchWithTimeout(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}`);
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

    // byWeek already covers the whole season (parseEspnSchedule), so next
    // week's pairing -- if the season has one -- is already sitting here.
    const nextWeekMatchups = espnNextWeekMatchupPreview(byWeek[week + 1], rosters);
    if (nextWeekMatchups.length) stats.nextWeekMatchups = nextWeekMatchups;

    const narrative = await generateNarrative(leagueName, stats)
        .catch((err) => {
            console.error(`Narrative generation failed for "${leagueName}" -- saving the stats without it:`, err.message);
            return fallbackNarrative(week, err.message);
        });
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
        const tokenResponse = await fetchWithTimeout('https://api.login.yahoo.com/oauth2/get_token', {
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
    const response = await fetchWithTimeout(`https://fantasysports.yahooapis.com/fantasy/v2/${endpoint}?format=json`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Yahoo API ${endpoint} -> HTTP ${response.status}: ${body}`);
    }
    return response.json();
};

const YAHOO_PLAYER_KEY_BATCH = 25;

// Yahoo's players/stats;type=week endpoint silently comes back with NO
// player_points for any team at all once too many team_keys are requested
// in one call -- not an error, just an empty result, which is why every
// player in this Yahoo path was reading 0 regardless of league size.
// src/utils/yahooService.js's fetchYahooPlayerPoints already worked around
// this exact quirk (see its comment) by chunking to a few teams per
// request with a per-team fallback when a chunk comes back empty --
// mirrored here since this endpoint hits Yahoo directly rather than
// through that client-side helper.
const YAHOO_TEAM_POINTS_CHUNK = 4;

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
    // Already fetched above -- no extra request to make player points
    // derivable if Yahoo doesn't hand them over directly.
    const statModifiers = parseYahooStatModifiers(settingsData);

    const weekTransactions = parseYahooTransactions(transactionsData)
        .filter(t => weekFromTimestamp(t.status_updated, seasonStartMs, startWeek) === week);

    // Every group below is an independent request, so they run together
    // rather than one after another. This endpoint runs against a hard
    // 300s ceiling with several leagues to get through, and walking a
    // 12-team league's roster chunks serially was a meaningful slice of
    // that budget for no reason.
    const playerKeys = [...new Set(weekTransactions.flatMap(t => t.player_keys || []))];
    const playerKeyGroups = [];
    for (let i = 0; i < playerKeys.length; i += YAHOO_PLAYER_KEY_BATCH) {
        playerKeyGroups.push(playerKeys.slice(i, i + YAHOO_PLAYER_KEY_BATCH));
    }
    const playerMeta = {};
    (await Promise.all(playerKeyGroups.map(group =>
        yahooApiRequest(accessToken, `league/${yahooLeagueKey}/players;player_keys=${group.join(',')}`)
            .then(parseYahooPlayers)
            .catch(() => [])
    ))).flat().forEach(p => { playerMeta[p.id] = p; });

    const teamKeys = [...new Set(scoreboardWeek.flatMap(m => (m.teams || []).map(t => t.team_key)).filter(Boolean))];
    const teamKeyGroups = [];
    for (let i = 0; i < teamKeys.length; i += YAHOO_TEAM_POINTS_CHUNK) {
        teamKeyGroups.push(teamKeys.slice(i, i + YAHOO_TEAM_POINTS_CHUNK));
    }
    const rosterPlayersByTeamKey = {};
    // Scoped under the LEAGUE, not the bare top-level `teams;team_keys=`
    // collection. Fantasy points are a function of the league's own scoring
    // settings, so Yahoo only returns a player_points node when the request
    // carries league context -- without it the response still has every
    // roster, name, position and selected_position (which is why those all
    // parsed fine) but no points at all, and each one silently read 0. The
    // diagnostic below confirmed exactly that: "all 151 players read 0
    // points -- player_points was not found on any entity".
    const rosterPath = (keys) => `league/${yahooLeagueKey}/teams;team_keys=${keys.join(',')}/roster;week=${week}/players/stats;type=week;week=${week}`;
    const rosterGroupResults = await Promise.all(teamKeyGroups.map(async (group) => {
        const rosterData = await yahooApiRequest(accessToken, rosterPath(group)).catch(() => null);
        if (rosterData) lastRosterResponse = rosterData;
        const parsed = rosterData ? extractYahooRosterPlayers(rosterData, statModifiers) : {};
        if (Object.keys(parsed).length) return parsed;
        // The batched form came back empty for this whole group -- fall
        // back to one team at a time, same recovery fetchYahooPlayerPoints
        // already relies on for this exact quirk.
        const singles = await Promise.all(group.map(teamKey =>
            yahooApiRequest(accessToken, rosterPath([teamKey]))
                .then(single => extractYahooRosterPlayers(single, statModifiers))
                .catch(() => ({}))
        ));
        return Object.assign({}, ...singles);
    }));
    Object.assign(rosterPlayersByTeamKey, ...rosterGroupResults);

    // Every player reading 0 is the signature of a points node this parser
    // never found -- it is never what a real week looks like. Logs the raw
    // shape of one player entity (just its keys, not a whole roster dump) so
    // the actual response structure is visible in the runtime logs rather
    // than having to be guessed at from the outside.
    const allRows = Object.values(rosterPlayersByTeamKey).flat();
    if (allRows.length && allRows.every(r => !r.actual)) {
        // Dump the RAW entity, not the parsed row. The parsed row only ever
        // says "actual: 0", which is the symptom, not the cause -- what's
        // actually needed is which nodes Yahoo did send, so the next fix
        // isn't another guess at the response shape.
        const rawSample = (() => {
            try {
                const teamsNode = lastRosterResponse?.fantasy_content?.teams
                    || findNode(lastRosterResponse?.fantasy_content?.league, 'teams')
                    || findNode(lastRosterResponse?.fantasy_content, 'teams');
                const team = yahooCollection(teamsNode)[0]?.team;
                const roster = findNode(team, 'roster');
                const players = findNode(roster, 'players') || findNode(team, 'players');
                const player = yahooCollection(players)[0]?.player;
                return JSON.stringify(player).slice(0, 1500);
            } catch {
                return 'could not extract a raw player entity';
            }
        })();
        console.error(
            `Yahoo weekly summary: all ${allRows.length} players read 0 points for week ${week}. `
            + `statModifiers parsed: ${Object.keys(statModifiers || {}).length} entries. `
            + `Raw player entity: ${rawSample}`
        );
    }

    const stats = computeYahooWeekStats({ scoreboardWeek, standingsRows, transactions: weekTransactions, rosterPlayersByTeamKey, playerMeta, week });

    // Best-effort, same reasoning as generateForLeague's Sleeper version --
    // no pairing published yet (e.g. season's last week) just means no
    // preview section, never a failed recap.
    const nextWeekMatchups = await yahooApiRequest(accessToken, `league/${yahooLeagueKey}/scoreboard;week=${week + 1}`)
        .then(data => yahooNextWeekMatchupPreview(parseYahooScoreboard(data, week + 1), standingsRows))
        .catch(() => []);
    if (nextWeekMatchups.length) stats.nextWeekMatchups = nextWeekMatchups;

    const narrative = await generateNarrative(leagueName, stats)
        .catch((err) => {
            console.error(`Narrative generation failed for "${leagueName}" -- saving the stats without it:`, err.message);
            return fallbackNarrative(week, err.message);
        });
    narrative.week = week;

    return { leagueDbId, season, week, stats, narrative };
};

// Public, unauthenticated read of exactly one already-generated recap --
// the Share button on WeeklySummary.jsx hands out a link built from these
// three values (leagueId/season/week), the same "anyone with the link"
// model Docs/Sheets use. league_id is an unguessable uuid, so knowing it
// (plus the season/week it was already shown for) is the only "credential"
// this needs; nothing here is listable or enumerable, and nothing beyond
// the recap itself (no emails, no user ids, no other weeks) is returned.
// Client-side Supabase reads can't serve this: league_weekly_summaries'
// RLS requires a real signed-in session (see schema-guards.sql section 6),
// which a link opened by a logged-out leaguemate never has -- so this has
// to go through the service-role client here instead.
const handlePublicShare = async (req, res) => {
    const { leagueId, season, week } = req.query || {};
    const weekNum = parseInt(week, 10);
    if (!leagueId || !season || !Number.isFinite(weekNum)) {
        return res.status(400).json({ error: 'Missing or invalid leagueId, season, or week.' });
    }

    const { data, error } = await supabase
        .from('league_weekly_summaries')
        .select('season, week, stats, narrative, generated_at, leagues!inner(league_name, platform)')
        .eq('league_id', leagueId)
        .eq('season', String(season))
        .eq('week', weekNum)
        .maybeSingle();

    if (error) {
        console.error('weekly-summary public share error:', error);
        return res.status(500).json({ error: 'Could not load this summary.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Summary not found.' });
    }

    return res.status(200).json({
        leagueName: data.leagues?.league_name || 'A Huddle Hub League',
        platform: data.leagues?.platform || null,
        season: data.season,
        week: data.week,
        stats: data.stats,
        narrative: data.narrative,
        generatedAt: data.generated_at,
    });
};

export default async function handler(req, res) {
    // Measured from the true start of the invocation. Anything set later
    // (after the membership query and the multi-megabyte Sleeper player
    // dictionary) undercounts the time already spent and lets the budget
    // below overrun the platform's own ceiling.
    const startedAt = Date.now();
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (req.method === 'GET' && req.query?.share === '1') {
        return handlePublicShare(req, res);
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
        // No FK from user_leagues.user_id to profiles.id is registered in
        // Supabase's schema cache (every other query in this codebase that
        // needs both -- e.g. Managers.jsx -- fetches them separately and
        // joins in JS for the same reason), so a `profiles!inner(...)`
        // embed here 400s with "Could not find a relationship". Fetched
        // and joined manually instead.
        const { data: memberships, error: memErr } = await supabase
            .from('user_leagues')
            .select('league_id, user_id, leagues!inner(id, sleeper_league_id, platform, league_name)');
        if (memErr) throw memErr;

        const membershipUserIds = [...new Set((memberships || []).map(row => row.user_id).filter(Boolean))];
        const profilesById = new Map();
        if (membershipUserIds.length) {
            const { data: profiles, error: profErr } = await supabase
                .from('profiles')
                .select('id, is_premium, email')
                .in('id', membershipUserIds);
            if (profErr) throw profErr;
            (profiles || []).forEach(p => profilesById.set(p.id, p));
        }

        const proLeagues = new Map();
        (memberships || []).forEach(row => {
            const league = row.leagues;
            const profile = profilesById.get(row.user_id);
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

        // NFL's own schedule pointer -- platform-agnostic, so it's the
        // shared source of both "what week is it" (below) and "what season
        // is it" for the ESPN path, which needs a season to even build its
        // league API URL. The `leagues` table itself carries no season
        // column (`leagues!inner(...season)` above is what 400'd with
        // "column leagues_1.season does not exist" until this was fixed) --
        // Sleeper and Yahoo don't need this since both read their own
        // season back off their own league-settings response instead.
        const nflState = await fetchJson('https://api.sleeper.app/v1/state/nfl');
        const currentSeason = String(nflState.season || new Date().getFullYear());

        const results = [];
        // Built up as leagues succeed, then flushed as ONE digest email per
        // recipient after the whole batch is done -- not per league as it's
        // computed -- so a Pro member in several leagues gets one email
        // listing all of them, not one email per league.
        const digestByEmail = new Map();

        // Leagues are independent of each other, and each one spends most
        // of its time waiting -- on a platform API, then on Gemini. Run
        // several at once rather than one after another: this endpoint has
        // a hard 300s ceiling, and walking leagues serially is what pushed
        // a real multi-league account past it (a 504 mid-run, which left
        // the leagues it never reached still showing their previous week's
        // recap and sent no digest emails at all, since that step is last).
        //
        // Capped rather than unbounded so a big account doesn't open a
        // burst of platform requests wide enough to get itself rate
        // limited.
        const LEAGUE_CONCURRENCY = 4;
        // Stop STARTING new leagues with enough headroom left to still
        // write what finished and send the digests. Overrunning the
        // platform's own timeout loses all of that, so finishing a smaller
        // batch cleanly beats dying with a full one in flight. Sized
        // against LEAGUE_TIMEOUT_MS so even a league started at the very
        // edge of the budget still lands inside the ceiling.
        const TIME_BUDGET_MS = 170000;
        const skipped = [];

        const processLeague = async ({ league, emails, userId }) => {
            try {
                let week = weekOverride;
                if (!week) {
                    const currentWeek = nflState.week || nflState.display_week || 1;
                    // "The week that just finished" -- by the time this cron
                    // fires (Tuesday), the current-week pointer has
                    // typically already rolled forward to the upcoming week.
                    week = Math.max(1, currentWeek - 1);
                }

                const generateForPlatform = () => league.platform === 'yahoo'
                    ? generateForYahooLeague({
                        leagueDbId: league.id,
                        yahooLeagueKey: league.sleeper_league_id,
                        leagueName: league.league_name || 'Your League',
                        week,
                        userId,
                    })
                    : league.platform === 'espn'
                    ? generateForEspnLeague({
                        leagueDbId: league.id,
                        espnLeagueId: fromEspnLeagueId(league.sleeper_league_id),
                        season: currentSeason,
                        leagueName: league.league_name || 'Your League',
                        week,
                        userId,
                    })
                    : generateForLeague({
                        leagueDbId: league.id,
                        sleeperLeagueId: league.sleeper_league_id,
                        leagueName: league.league_name || 'Your League',
                        week,
                        playersCache,
                        projectionsCache,
                    });

                const generated = await withDeadline(
                    generateForPlatform(),
                    LEAGUE_TIMEOUT_MS,
                    `${league.platform} league "${league.league_name || league.id}"`
                );

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
                        if (!digestByEmail.has(email)) digestByEmail.set(email, []);
                        digestByEmail.get(email).push({
                            leagueId: league.id,
                            leagueName: league.league_name || 'Your League',
                            headline: generated.narrative.headline,
                            week: generated.week,
                        });
                    }
                }

                results.push({ leagueId: league.id, leagueName: league.league_name, week: generated.week, recipients: dryRun ? 0 : emails.size, ...(dryRun ? { stats: generated.stats, narrative: generated.narrative } : {}) });
            } catch (leagueErr) {
                console.error(`Weekly summary failed for league ${league.id}:`, leagueErr);
                results.push({ leagueId: league.id, leagueName: league.league_name, error: leagueErr.message });
            }
        };

        const queue = [...proLeagues.values()];
        const runWorker = async () => {
            while (queue.length) {
                if (Date.now() - startedAt > TIME_BUDGET_MS) {
                    // Out of budget: hand back what's left by name rather
                    // than half-processing it, so re-running finishes the
                    // job and the caller can see it was cut short.
                    skipped.push(...queue.splice(0).map(({ league }) => ({
                        leagueId: league.id,
                        leagueName: league.league_name,
                    })));
                    return;
                }
                const nextLeague = queue.shift();
                if (nextLeague) await processLeague(nextLeague);
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(LEAGUE_CONCURRENCY, queue.length) }, runWorker)
        );

        let digestsSent = 0;
        if (!dryRun) {
            // Resend allows 10 requests/second and rejects the rest with a
            // 429 -- firing every digest at once got them all rate limited
            // and silently dropped. Paced just under the limit instead.
            const RESEND_PER_SECOND = 8;
            const recipients = [...digestByEmail];
            for (let i = 0; i < recipients.length; i += RESEND_PER_SECOND) {
                const batch = recipients.slice(i, i + RESEND_PER_SECOND);
                const sendResults = await Promise.all(
                    batch.map(([email, leagues]) => sendDigestEmail(email, leagues))
                );
                digestsSent += sendResults.filter(r => r.sent).length;
                if (i + RESEND_PER_SECOND < recipients.length) {
                    await new Promise(resolve => setTimeout(resolve, 1100));
                }
            }
        }

        if (skipped.length) {
            console.error(
                `Weekly summary ran out of time after ${Math.round((Date.now() - startedAt) / 1000)}s with `
                + `${skipped.length} league(s) unprocessed: ${skipped.map(s => s.leagueName || s.leagueId).join(', ')}. `
                + 'Re-run to finish them.'
            );
        }

        return res.status(200).json({
            processed: results.length,
            dryRun,
            allowlistActive: allowedEmails.length > 0,
            digestsSent,
            elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
            ...(skipped.length ? { skipped, skippedNote: 'Ran out of time before these leagues. Re-run to finish them.' } : {}),
            results,
        });
    } catch (error) {
        console.error('weekly-summary handler error:', error);
        // A thrown Supabase/Postgrest error is a plain object, not an Error
        // instance -- error.toString() on one of those collapses to the
        // useless literal string "[object Object]" instead of its real
        // .message, which is exactly what happens when e.g. the initial
        // user_leagues query above fails. Fall back through .message, then
        // a full JSON dump, so whatever actually broke is visible in the
        // response instead of swallowed.
        const message = error?.message || (typeof error === 'string' ? error : JSON.stringify(error));
        return res.status(500).json({ error: message });
    }
}
