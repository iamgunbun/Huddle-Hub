import assert from 'node:assert/strict';

// api/weekly-summary.js constructs its Supabase client at module load time
// (the same pattern every other api/*.js file already uses), which means
// just importing the file -- to reach the pure stat functions below --
// requires these to be set. Dummy values: nothing in this script ever
// actually talks to Supabase. A dynamic import (rather than a static one)
// is required here: static imports are hoisted above any code in this file,
// which would set these too late for weekly-summary.js's module-level
// createClient() call to see them.
process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key-for-verify-script-only';

// api/weekly-summary.js is a serverless function (not part of the Vite src/
// graph), but its stat math is pure and exported specifically so it can be
// checked here -- this endpoint runs unattended on a Tuesday cron and emails
// real Pro subscribers, so a wrong "biggest blowout" or "MVP" can't be caught
// by a person looking at a screen before it ships the way a UI bug would be.
const { computeWeekStats, teamNameFor, computeYahooWeekStats, teamNameForYahoo, extractYahooRosterPlayers, buildEspnStatsInputs, buildDigestEmailHtml } = await import('../api/weekly-summary.js');

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

// --- Synthetic 4-team, 2-matchup week, built so every stat has exactly one
// unambiguous correct answer. ---
const rosters = [
    { roster_id: 1, owner_id: 'u1', settings: { wins: 8, losses: 2 } },  // net +6
    { roster_id: 2, owner_id: 'u2', settings: { wins: 7, losses: 3 } },  // net +4
    { roster_id: 3, owner_id: 'u3', settings: { wins: 2, losses: 8 } },  // net -6
    { roster_id: 4, owner_id: 'u4', settings: { wins: 1, losses: 9 } },  // net -8
];
const users = [
    { user_id: 'u1', display_name: 'Alpha', metadata: { team_name: 'Team Alpha' } },
    { user_id: 'u2', display_name: 'Bravo', metadata: { team_name: 'Team Bravo' } },
    { user_id: 'u3', display_name: 'Charlie', metadata: { team_name: 'Team Charlie' } },
    { user_id: 'u4', display_name: 'Delta', metadata: { team_name: 'Team Delta' } },
];

// Matchup 1 (roster 1 vs 4): the blowout -- large score margin, large record gap (14).
// Matchup 2 (roster 2 vs 3): the closest call by score AND the closest by record (gap 10) -- the rivalry pick.
const matchups = [
    { matchup_id: 1, roster_id: 1, points: 150.5, starters: ['qb1', 'rb1'], starters_points: [30, 20] },
    { matchup_id: 1, roster_id: 4, points: 90.2, starters: ['qb2', 'k1'], starters_points: [10, 12] },
    { matchup_id: 2, roster_id: 2, points: 110.0, starters: ['wr1', 'te1'], starters_points: [15, 8] },
    { matchup_id: 2, roster_id: 3, points: 108.5, starters: ['rb2', 'wr2'], starters_points: [5, 25] },
];

const players = {
    qb1: { first_name: 'Quinn', last_name: 'Best', position: 'QB' },
    qb2: { first_name: 'Quinn', last_name: 'Worst', position: 'QB' },
    rb1: { first_name: 'Rusher', last_name: 'One', position: 'RB' },
    rb2: { first_name: 'Rusher', last_name: 'Two', position: 'RB' },
    wr1: { first_name: 'Wideout', last_name: 'One', position: 'WR' },
    wr2: { first_name: 'Wideout', last_name: 'Two', position: 'WR' },
    te1: { first_name: 'Tight', last_name: 'End', position: 'TE' },
    k1: { first_name: 'Kick', last_name: 'Er', position: 'K' },
};

// Team Charlie (roster 3, rb2+wr2) is the only team whose combined starter
// projection (100+12=112) exceeds its actual score (108.5) -- every other
// team's actual score clears its own projected total by a wide margin, so
// Charlie is the one, unambiguous biggest disappointment at the TEAM level.
const projById = {
    qb1: 28, qb2: 9, rb1: 18, rb2: 100, wr1: 20, wr2: 12, te1: 10, k1: 6,
};

const transactions = [
    { type: 'waiver', roster_ids: [3], adds: { rb2: 3 }, settings: { waiver_bid: 15 } },
    { type: 'trade', roster_ids: [1, 2], adds: { wr1: 2 } },
];

const stats = computeWeekStats({ matchups, rosters, users, transactions, players, projById, week: 5 });

// --- teamNameFor ---
check('resolves a team name from the roster/user metadata', teamNameFor(1, rosters, users), 'Team Alpha');
check('falls back to a generic label for an unknown roster', teamNameFor(99, rosters, users), 'Team 99');

// --- blowout / closest call ---
check('the blowout is the largest-margin matchup', stats.blowout.winner, 'Team Alpha');
check('the blowout margin is the real score difference', stats.blowout.margin, Math.round((150.5 - 90.2) * 100) / 100);
check('the closest call is the smallest-margin matchup', [stats.closestCall.teamA, stats.closestCall.teamB].sort(), ['Team Bravo', 'Team Charlie'].sort());
check('the closest call margin is the real score difference', stats.closestCall.margin, 1.5);

// --- rivalry (by record gap, not by score) ---
check('rivalry picks the matchup with the smaller record gap, not the closer score', [stats.rivalry.teamA, stats.rivalry.teamB].sort(), ['Team Bravo', 'Team Charlie'].sort());
check('the reported record gap is correct', stats.rivalry.recordGap, 10);

// --- position MVPs ---
check('QB MVP is the higher scorer', stats.mvpByPosition.QB.name, 'Quinn Best');
check('RB MVP is the higher scorer', stats.mvpByPosition.RB.name, 'Rusher One');
check('WR MVP is the higher scorer', stats.mvpByPosition.WR.name, 'Wideout Two');
check('TE MVP is the only TE starter', stats.mvpByPosition.TE.name, 'Tight End');
check('K MVP is the only K starter', stats.mvpByPosition.K.name, 'Kick Er');
check('no DEF starters this week means no DEF MVP entry', stats.mvpByPosition.DEF, undefined);

// --- biggest disappointment is a TEAM, not a player ---
check('the biggest disappointment is the team whose actual score fell short of its starters\' combined projection', stats.biggestDisappointment.team, 'Team Charlie');
check('the reported variance is the team\'s actual total minus its projected total', stats.biggestDisappointment.variance, Math.round((108.5 - 112) * 100) / 100);
check('the reported projected total is the sum of that team\'s own starters\' projections', stats.biggestDisappointment.projected, 112);

// --- transactions summary ---
check('waiver moves are counted separately from trades', stats.transactions.waiverCount, 1);
check('trades are counted separately from waiver moves', stats.transactions.tradeCount, 1);
check('a notable add is attributed to the right team', stats.transactions.notableAdds[0].team, 'Team Charlie');
check('a notable add carries its FAAB bid', stats.transactions.notableAdds[0].faab, 15);

// --- an unresolvable pair (no matching opponent this week) is dropped, not crashed on ---
const lonelyStats = computeWeekStats({
    matchups: [{ matchup_id: 1, roster_id: 1, points: 100, starters: [], starters_points: [] }],
    rosters, users, transactions: [], players, projById, week: 1,
});
check('a matchup with no paired opponent produces no blowout/closest-call/rivalry rather than throwing', [lonelyStats.blowout, lonelyStats.closestCall, lonelyStats.rivalry], [null, null, null]);

// ============================================================================
// Yahoo -- a fully separate pipeline (computeYahooWeekStats), built because
// Yahoo's API gives team-level projections only (no per-player projection),
// so "biggest disappointment" is redefined at the team level there. Same
// 4-team shape as the Sleeper scenario above so the two are easy to compare.
// ============================================================================

const standingsRows = [
    { rosterId: 1, teamKey: '461.l.999.t.1', teamName: 'Team Alpha', wins: 8, losses: 2 },
    { rosterId: 2, teamKey: '461.l.999.t.2', teamName: 'Team Bravo', wins: 7, losses: 3 },
    { rosterId: 3, teamKey: '461.l.999.t.3', teamName: 'Team Charlie', wins: 2, losses: 8 },
    { rosterId: 4, teamKey: '461.l.999.t.4', teamName: 'Team Delta', wins: 1, losses: 9 },
];

// Matchup 1 (Alpha vs Delta): the blowout. Matchup 2 (Bravo vs Charlie): the
// closest call AND the smaller record gap (10 vs 14) -- the rivalry pick.
// Charlie's team score (108.5) came in well under its own Yahoo-reported
// projection (130) -- the biggest team-level shortfall, and Yahoo's own
// projection is the only one this path has to compare against.
const scoreboardWeek = [
    { week: 5, teams: [
        { roster_id: 1, team_key: '461.l.999.t.1', points: 150.5, projected_points: 130 },
        { roster_id: 4, team_key: '461.l.999.t.4', points: 90.2, projected_points: 95 },
    ] },
    { week: 5, teams: [
        { roster_id: 2, team_key: '461.l.999.t.2', points: 110.0, projected_points: 100 },
        { roster_id: 3, team_key: '461.l.999.t.3', points: 108.5, projected_points: 130 },
    ] },
];

// Raw Yahoo shape (array-of-single-key-objects entities), the same quirks
// yahooHistory.js's own parsers navigate -- built by hand rather than through
// parseYahooScoreboard/parseYahooStandings above specifically to exercise
// extractYahooRosterPlayers' own reading of that shape, including
// selected_position, which no other parser in this codebase reads yet.
const yahooPlayerEntity = ({ id, name, position, points, selectedPosition }) => ({
    player: [
        [
            { player_key: `461.p.${id}` },
            { player_id: String(id) },
            { name: { full: name } },
            { display_position: position },
            { editorial_team_abbr: 'kc' },
        ],
        { player_points: { coverage_type: 'week', week: '5', total: String(points) } },
        ...(selectedPosition === undefined ? [] : [{ selected_position: [{ coverage_type: 'week' }, { position: selectedPosition }] }]),
    ],
});

const rosterData = {
    fantasy_content: {
        teams: {
            0: {
                team: [
                    [{ team_key: '461.l.999.t.1' }, { team_id: '1' }, { name: 'Team Alpha' }],
                    { roster: { 0: { players: {
                        0: yahooPlayerEntity({ id: 100, name: 'Ace Thrower', position: 'QB', points: 32.4, selectedPosition: 'QB' }),
                        // A huge score, but benched -- must not win the QB/RB MVP race it would otherwise take.
                        1: yahooPlayerEntity({ id: 101, name: 'Benchwarmer', position: 'RB', points: 40, selectedPosition: 'BN' }),
                        count: 2,
                    } } } },
                ],
            },
            1: {
                team: [
                    [{ team_key: '461.l.999.t.2' }, { team_id: '2' }, { name: 'Team Bravo' }],
                    { roster: { 0: { players: {
                        0: yahooPlayerEntity({ id: 102, name: 'Rusher Prime', position: 'RB', points: 25.0, selectedPosition: 'RB' }),
                        // No selected_position node at all -- must default to NOT a starter rather than guessing.
                        1: yahooPlayerEntity({ id: 103, name: 'No Pos Data', position: 'WR', points: 10 }),
                        count: 2,
                    } } } },
                ],
            },
            count: 2,
        },
    },
};

const rosterPlayersByTeamKey = extractYahooRosterPlayers(rosterData);

// --- extractYahooRosterPlayers ---
check('roster extraction keys players by team_key', Object.keys(rosterPlayersByTeamKey).sort(), ['461.l.999.t.1', '461.l.999.t.2']);
check('actual points are read from player_points.total', rosterPlayersByTeamKey['461.l.999.t.1'].find(p => p.playerId === '100').actual, 32.4);
check('a starter is flagged as a starter', rosterPlayersByTeamKey['461.l.999.t.1'].find(p => p.playerId === '100').isStarter, true);
check('a high-scoring benched player is not flagged as a starter', rosterPlayersByTeamKey['461.l.999.t.1'].find(p => p.playerId === '101').isStarter, false);
check('a player missing selected_position defaults to not-a-starter rather than guessing', rosterPlayersByTeamKey['461.l.999.t.2'].find(p => p.playerId === '103').isStarter, false);

const yahooTransactions = [
    { type: 'waiver', roster_ids: [3], adds: { '500': 3 }, settings: { waiver_bid: 22 } },
    { type: 'trade', roster_ids: [1, 2], adds: { '501': 2 } },
];
const playerMeta = {
    '500': { fn: 'Add', ln: 'Ition' },
    '501': { fn: 'Trade', ln: 'Away' },
};

const yahooStats = computeYahooWeekStats({ scoreboardWeek, standingsRows, transactions: yahooTransactions, rosterPlayersByTeamKey, playerMeta, week: 5 });

// --- teamNameForYahoo ---
check('resolves a team name from standings rows', teamNameForYahoo(1, standingsRows), 'Team Alpha');
check('falls back to a generic label for an unknown roster', teamNameForYahoo(99, standingsRows), 'Team 99');

// --- blowout / closest call / rivalry (same logic as Sleeper's, fed team-level scoreboard rows) ---
check('the blowout is the largest-margin matchup', yahooStats.blowout.winner, 'Team Alpha');
check('the blowout margin is the real score difference', yahooStats.blowout.margin, Math.round((150.5 - 90.2) * 100) / 100);
check('the closest call is the smallest-margin matchup', [yahooStats.closestCall.teamA, yahooStats.closestCall.teamB].sort(), ['Team Bravo', 'Team Charlie'].sort());
check('rivalry picks the matchup with the smaller record gap', [yahooStats.rivalry.teamA, yahooStats.rivalry.teamB].sort(), ['Team Bravo', 'Team Charlie'].sort());
check('the reported record gap is correct', yahooStats.rivalry.recordGap, 10);

// --- position MVPs (starters only) ---
check('QB MVP is the only QB starter', yahooStats.mvpByPosition.QB.name, 'Ace Thrower');
check('RB MVP is the only RB starter (the benched higher scorer is excluded)', yahooStats.mvpByPosition.RB.name, 'Rusher Prime');
check('no WR starter this week means no WR MVP entry', yahooStats.mvpByPosition.WR, undefined);

// --- biggest disappointment is a TEAM here, not a player -- Yahoo has no per-player projection to compare against ---
check('the biggest disappointment is the team with the worst team-level projection shortfall', yahooStats.biggestDisappointment.team, 'Team Charlie');
check('the reported variance is actual minus Yahoo\'s own team projection', yahooStats.biggestDisappointment.variance, Math.round((108.5 - 130) * 100) / 100);

// --- transactions summary ---
check('waiver moves are counted separately from trades', yahooStats.transactions.waiverCount, 1);
check('trades are counted separately from waiver moves', yahooStats.transactions.tradeCount, 1);
check('a notable add is attributed to the right team', yahooStats.transactions.notableAdds[0].team, 'Team Charlie');
check('a notable add carries its FAAB bid', yahooStats.transactions.notableAdds[0].faab, 22);
check('a notable add resolves the player name via playerMeta', yahooStats.transactions.notableAdds[0].added, ['Add Ition']);
check('a trade lists both teams involved', yahooStats.transactions.trades[0].teams.sort(), ['Team Alpha', 'Team Bravo'].sort());

// ============================================================================
// ESPN -- reshaped into computeWeekStats' own input shape (buildEspnStatsInputs)
// and run through that SAME already-tested function, rather than a separate
// compute function -- ESPN publishes a real per-player projection alongside
// the real actual, so there's nothing to redefine for ESPN specifically.
// Same scores/players as the Sleeper scenario at the top of this file
// (renamed), so the same stat picks (blowout winner, MVPs, the team-level
// disappointment) should come out identically -- confirming the reshape
// preserves the numbers rather than just matching computeWeekStats' shape.
// ============================================================================

const espnRosters = {
    1: { roster_id: 1, owner_id: 'owner1', team_name: 'Team Alpha', starters: ['200', '201'], settings: { wins: 8, losses: 2 } },
    2: { roster_id: 2, owner_id: 'owner2', team_name: 'Team Bravo', starters: ['202', '203'], settings: { wins: 7, losses: 3 } },
    3: { roster_id: 3, owner_id: 'owner3', team_name: 'Team Charlie', starters: ['204', '205'], settings: { wins: 2, losses: 8 } },
    4: { roster_id: 4, owner_id: 'owner4', team_name: 'Team Delta', starters: ['206', '207'], settings: { wins: 1, losses: 9 } },
};

// actual/projected mirror the Sleeper fixture's qb1/rb1/wr1/te1/rb2/wr2/qb2/k1.
const espnPlayersMeta = {
    '200': { fn: 'Ace', ln: 'Thrower', pos: 'QB', actualPoints: 30, projectedPoints: 28 },
    '201': { fn: 'Rusher', ln: 'One', pos: 'RB', actualPoints: 20, projectedPoints: 18 },
    '202': { fn: 'Wideout', ln: 'One', pos: 'WR', actualPoints: 15, projectedPoints: 20 },
    '203': { fn: 'Tight', ln: 'End', pos: 'TE', actualPoints: 8, projectedPoints: 10 },
    // 204+205's combined projection (112) is what pushes Team Charlie's
    // actual (108.5) into the only negative team-level variance this week.
    '204': { fn: 'Rusher', ln: 'Two', pos: 'RB', actualPoints: 5, projectedPoints: 100 },
    '205': { fn: 'Wideout', ln: 'Two', pos: 'WR', actualPoints: 25, projectedPoints: 12 },
    '206': { fn: 'Quinn', ln: 'Worst', pos: 'QB', actualPoints: 10, projectedPoints: 9 },
    '207': { fn: 'Kick', ln: 'Er', pos: 'K', actualPoints: 12, projectedPoints: 6 },
    '300': { fn: 'Add', ln: 'Ition', pos: 'WR', actualPoints: 0, projectedPoints: null },
    '301': { fn: 'Trade', ln: 'Away', pos: 'RB', actualPoints: 0, projectedPoints: null },
};

// Matchup 1 (Alpha vs Delta): the blowout. Matchup 2 (Bravo vs Charlie): the
// closest call and (records 7-3 vs 2-8, gap 10 -- smaller than Alpha/Delta's 14)
// the rivalry pick. Same scores as the Sleeper/Yahoo scenarios above.
const espnByWeek = {
    5: [
        [
            { roster_id: 1, points: 150.5, projected_points: 140 },
            { roster_id: 4, points: 90.2, projected_points: 95 },
        ],
        [
            { roster_id: 2, points: 110.0, projected_points: 100 },
            { roster_id: 3, points: 108.5, projected_points: 130 },
        ],
    ],
};

const espnTransactions = [
    { type: 'waiver', roster_ids: [3], adds: { '300': 3 }, settings: { waiver_bid: 22 }, leg: 5 },
    { type: 'trade', roster_ids: [1, 2], adds: { '301': 2 }, leg: 5 },
    // A different week's transaction -- must be excluded by the week filter.
    { type: 'waiver', roster_ids: [4], adds: { '302': 4 }, settings: { waiver_bid: 5 }, leg: 4 },
];

const espnInputs = buildEspnStatsInputs({ byWeek: espnByWeek, week: 5, rosters: espnRosters, playersMeta: espnPlayersMeta, transactions: espnTransactions });

// --- buildEspnStatsInputs' reshape itself ---
check('each matchup pair becomes one row per team, sharing a matchup_id', espnInputs.matchups.filter(m => m.matchup_id === 1).map(m => m.roster_id).sort(), [1, 4]);
check('starters_points is read off playersMeta.actualPoints in starter order', espnInputs.matchups.find(m => m.roster_id === 3).starters_points, [5, 25]);
check('a synthetic user row carries the ESPN team name through as display_name', espnInputs.users.find(u => u.user_id === 'owner1').display_name, 'Team Alpha');
check('transactions are filtered down to the requested week only', espnInputs.transactions.length, 2);

// --- fed into the SAME computeWeekStats Sleeper uses -- same picks as the Sleeper scenario above ---
const espnStats = computeWeekStats(espnInputs);

check('the blowout is the largest-margin matchup', espnStats.blowout.winner, 'Team Alpha');
check('the closest call / rivalry both land on the smaller-record-gap matchup', [espnStats.closestCall.teamA, espnStats.closestCall.teamB].sort(), ['Team Bravo', 'Team Charlie'].sort());
check('rivalry record gap is correct', espnStats.rivalry.recordGap, 10);
check('QB MVP is the higher scorer', espnStats.mvpByPosition.QB.name, 'Ace Thrower');
check('RB MVP is the higher scorer', espnStats.mvpByPosition.RB.name, 'Rusher One');
check('WR MVP is the higher scorer', espnStats.mvpByPosition.WR.name, 'Wideout Two');
check('the biggest disappointment is a team, not a player, and matches the Sleeper scenario\'s pick', espnStats.biggestDisappointment.team, 'Team Charlie');
check('the reported variance is the team\'s actual minus its starters\' combined projection', espnStats.biggestDisappointment.variance, Math.round((108.5 - 112) * 100) / 100);
check('waiver and trade counts match the week-filtered transactions', [espnStats.transactions.waiverCount, espnStats.transactions.tradeCount], [1, 1]);
check('a notable add resolves its team and FAAB bid', [espnStats.transactions.notableAdds[0].team, espnStats.transactions.notableAdds[0].faab], ['Team Charlie', 22]);

// --- a bye week (an unpaired team) doesn't crash the reshape ---
const byeInputs = buildEspnStatsInputs({
    byWeek: { 5: [[{ roster_id: 1, points: 100, projected_points: 90 }]] },
    week: 5, rosters: espnRosters, playersMeta: espnPlayersMeta, transactions: [],
});
check('a bye-week pair with only one team produces one matchup row rather than throwing', byeInputs.matchups.length, 1);

// ============================================================================
// Digest email -- ONE email per recipient covering every league of theirs
// that's ready, not one full-recap email per league. A Pro member in 6
// leagues used to get 6 separate emails every Tuesday; this checks the
// digest lists all of them with a working per-league link instead.
// ============================================================================

const digestLeagues = [
    { leagueId: 'league-a', leagueName: 'Dynasty Warriors', headline: 'Alpha survives a shootout', week: 5 },
    { leagueId: 'league-b', leagueName: 'Redraft Rumble', headline: 'Bravo squeaks by', week: 5 },
];
const digestHtml = buildDigestEmailHtml(digestLeagues);

check('the digest names every league it covers', ['Dynasty Warriors', 'Redraft Rumble'].every(name => digestHtml.includes(name)), true);
check('each league gets its own View Summary link, deep-linked by id', digestHtml.includes('/weekly-summary?league=league-a') && digestHtml.includes('/weekly-summary?league=league-b'), true);
check('the digest headline is plural for more than one league', digestHtml.includes('Your Weekly Summaries Are Ready'), true);
check('a single-league digest uses the singular headline instead', buildDigestEmailHtml([digestLeagues[0]]).includes('Your Weekly Summary Is Ready'), true);

console.log(`OK: ${checks} weekly-summary checks passed`);
