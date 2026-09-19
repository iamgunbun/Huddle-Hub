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
const {
    computeWeekStats, teamNameFor, nextWeekMatchupPreview,
    buildScoreboard, buildScoringContext, buildPowerRankings, buildBenchCalls, buildLuckWatch,
    computeYahooWeekStats, teamNameForYahoo, extractYahooRosterPlayers, yahooNextWeekMatchupPreview, findYahooPlayerPoints,
    buildEspnStatsInputs, espnNextWeekMatchupPreview,
    buildDigestEmailHtml, withDeadline, fetchWithTimeout,
    parseYahooStatModifiers, scoreYahooStatLine, narrativePayload, NARRATIVE_SCHEMA,
} = await import('../api/weekly-summary.js');

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
check('a notable add that started this week carries its real points', stats.transactions.notableAdds[0].added, [{ name: 'Rusher Two', pointsThisWeek: 5 }]);

// --- nextWeekMatchupPreview: real pairings for a future week, off Sleeper's own matchup shape ---
const futureMatchups = [
    { matchup_id: 1, roster_id: 1, points: 0, starters: [], starters_points: [] },
    { matchup_id: 1, roster_id: 2, points: 0, starters: [], starters_points: [] },
    // A bye-week team with no paired opponent -- must be dropped, not crashed on.
    { matchup_id: 2, roster_id: 3, points: 0, starters: [], starters_points: [] },
];
const nextWeek = nextWeekMatchupPreview(futureMatchups, rosters, users);
check('next week pairing resolves both real team names', [nextWeek[0].teamA, nextWeek[0].teamB].sort(), ['Team Alpha', 'Team Bravo'].sort());
check('an unpaired (bye) team produces no extra pairing', nextWeek.length, 1);
check('no future matchups at all produces an empty list rather than throwing', nextWeekMatchupPreview([], rosters, users), []);

// ============================================================================
// The league-wide eval -- platform-neutral, so these are checked directly
// against hand-built inputs (one unambiguous right answer each) as well as
// through the real Sleeper scenario above.
// ============================================================================

// --- buildScoreboard: every result, ranked by winning score ---
const evalScoreboard = buildScoreboard(stats.games);
check('the scoreboard covers every game, not just the extremes', evalScoreboard.length, 2);
check('the scoreboard leads with the highest winning score', evalScoreboard[0].winner, 'Team Alpha');
check('the scoreboard pairs each winner with the team they actually beat', evalScoreboard[0].loser, 'Team Delta');
check('winner and loser scores are not swapped', [evalScoreboard[0].winnerScore, evalScoreboard[0].loserScore], [150.5, 90.2]);
check('a tie is flagged rather than inventing a winner', buildScoreboard([
    { teamA: 'A', teamB: 'B', scoreA: 100, scoreB: 100, margin: 0, winner: null },
])[0].tie, true);

// --- buildScoringContext ---
const evalContext = buildScoringContext([
    { team: 'Alpha', score: 150.5 }, { team: 'Bravo', score: 110 },
    { team: 'Charlie', score: 108.5 }, { team: 'Delta', score: 90.2 },
]);
check('the league average is the real mean of the week', evalContext.average, Math.round(((150.5 + 110 + 108.5 + 90.2) / 4) * 100) / 100);
check('the median of an even field averages the middle two', evalContext.median, Math.round(((110 + 108.5) / 2) * 100) / 100);
check('the highest score names the right team', [evalContext.highest.team, evalContext.highest.score], ['Alpha', 150.5]);
check('the lowest score names the right team', [evalContext.lowest.team, evalContext.lowest.score], ['Delta', 90.2]);
check('every score is listed, ranked high to low', evalContext.allScores.map(s => s.team), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
check('no scores at all produces null rather than throwing', buildScoringContext([]), null);

// --- buildPowerRankings: record first, points-for as the tiebreak ---
const evalRankings = buildPowerRankings([
    { team: 'Even Record Low Points', wins: 5, losses: 5, pointsFor: 900 },
    { team: 'Best Record', wins: 9, losses: 1, pointsFor: 800 },
    { team: 'Even Record High Points', wins: 5, losses: 5, pointsFor: 1100 },
]);
check('the best record ranks first even on fewer points', evalRankings[0].team, 'Best Record');
check('equal records break by points scored', [evalRankings[1].team, evalRankings[2].team], ['Even Record High Points', 'Even Record Low Points']);
check('ranks are numbered from 1', evalRankings.map(r => r.rank), [1, 2, 3]);

// --- buildBenchCalls: only a real same-position decision counts ---
const evalBenchCalls = buildBenchCalls([
    {
        team: 'Blew It',
        players: [
            { name: 'Started Dud', position: 'RB', actual: 3, isStarter: true },
            { name: 'Benched Stud', position: 'RB', actual: 28, isStarter: false },
        ],
    },
    {
        // A benched QB outscoring a started KICKER is not a decision anyone
        // got to make -- it must not be reported as a mistake.
        team: 'Cross Position Non Mistake',
        players: [
            { name: 'Started Kicker', position: 'K', actual: 4, isStarter: true },
            { name: 'Benched QB', position: 'QB', actual: 30, isStarter: false },
        ],
    },
    {
        team: 'Got It Right',
        players: [
            { name: 'Started Stud', position: 'WR', actual: 25, isStarter: true },
            { name: 'Benched Dud', position: 'WR', actual: 2, isStarter: false },
        ],
    },
]);
check('only the team that actually misplayed a position appears', evalBenchCalls.map(c => c.team), ['Blew It']);
check('points left on the bench is the real difference', evalBenchCalls[0].pointsLeft, 25);
check('the call names both the benched player and who was started over them', [evalBenchCalls[0].benched, evalBenchCalls[0].started], ['Benched Stud', 'Started Dud']);
check('worst calls come first', buildBenchCalls([
    { team: 'Small Miss', players: [
        { name: 'S1', position: 'TE', actual: 10, isStarter: true },
        { name: 'B1', position: 'TE', actual: 13, isStarter: false },
    ] },
    { team: 'Huge Miss', players: [
        { name: 'S2', position: 'TE', actual: 1, isStarter: true },
        { name: 'B2', position: 'TE', actual: 31, isStarter: false },
    ] },
]).map(c => c.team), ['Huge Miss', 'Small Miss']);

// --- buildLuckWatch ---
const evalLuck = buildLuckWatch(evalScoreboard, evalContext.average);
check('the luckiest win is the lowest score that still won', evalLuck.luckiestWin.team, 'Team Bravo');
check('the unluckiest loss is the highest score that still lost', evalLuck.unluckiestLoss.team, 'Team Charlie');
check('luck is measured against the real league average', evalLuck.unluckiestLoss.vsLeagueAverage, Math.round((108.5 - evalContext.average) * 100) / 100);
check('an all-tie week produces no luck watch rather than throwing', buildLuckWatch([{ tie: true }], 100), null);

// --- the eval is attached to the real computed stats, not just standalone ---
check('computeWeekStats now carries the full scoreboard', stats.scoreboard.length, 2);
check('computeWeekStats now carries power rankings for every team', stats.powerRankings.length, 4);
check('computeWeekStats now carries the league scoring context', stats.scoringContext.highest.team, 'Team Alpha');

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

// --- player_points found in BOTH of Yahoo's entity shapes ---
// The array form above already passes. This is the numeric-key object form
// (quirk 3: a node carrying sub-collections and scalars is keyed
// "0","1","2",... instead of being a real array) -- reading it the shallow
// way returned undefined, which silently became 0 for every player and is
// what made a whole Yahoo league's weekly summary read 0.0 across the board.
const numericKeyPlayerEntity = {
    0: [
        { player_key: '461.p.900' },
        { player_id: '900' },
        { name: { full: 'Object Shaped' } },
        { display_position: 'WR' },
    ],
    1: { player_stats: { coverage_type: 'week', week: '5', stats: [] } },
    2: { player_points: { coverage_type: 'week', week: '5', total: '18.6' } },
    3: { selected_position: [{ coverage_type: 'week' }, { position: 'WR' }] },
};
check('points are found when the player entity is an array of single-key objects', findYahooPlayerPoints([
    [{ player_id: '901' }],
    { player_points: { total: '12.3' } },
])?.total, '12.3');
check('points are found when the player entity is the numeric-key object form instead', findYahooPlayerPoints(numericKeyPlayerEntity)?.total, '18.6');
check('a player entity with genuinely no points node returns null rather than a bogus zero', findYahooPlayerPoints([[{ player_id: '902' }]]), null);
check('a non-object player entity does not throw', findYahooPlayerPoints(null), null);

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
check(
    'a notable add resolves the player name via playerMeta, with null points since they never started',
    yahooStats.transactions.notableAdds[0].added,
    [{ name: 'Add Ition', pointsThisWeek: null }]
);
check('a trade lists both teams involved', yahooStats.transactions.trades[0].teams.sort(), ['Team Alpha', 'Team Bravo'].sort());

// --- yahooNextWeekMatchupPreview ---
const yahooFutureScoreboard = [
    { week: 6, teams: [
        { roster_id: 1, team_key: '461.l.999.t.1', points: 0 },
        { roster_id: 2, team_key: '461.l.999.t.2', points: 0 },
    ] },
];
check(
    'resolves next week\'s real Yahoo team names from standings',
    yahooNextWeekMatchupPreview(yahooFutureScoreboard, standingsRows).map(m => [m.teamA, m.teamB].sort()),
    [['Team Alpha', 'Team Bravo'].sort()]
);
check('no future scoreboard at all produces an empty list rather than throwing', yahooNextWeekMatchupPreview([], standingsRows), []);

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
check(
    'a notable add that did not start this week carries null points, not zero',
    espnStats.transactions.notableAdds[0].added,
    [{ name: 'Add Ition', pointsThisWeek: null }]
);

// --- espnNextWeekMatchupPreview: pairing off byWeek, no extra fetch needed ---
const espnFutureWeek = [
    [
        { roster_id: 1, points: 0 },
        { roster_id: 2, points: 0 },
    ],
];
check(
    'resolves next week\'s real ESPN team names from the rosters map',
    espnNextWeekMatchupPreview(espnFutureWeek, espnRosters).map(m => [m.teamA, m.teamB].sort()),
    [['Team Alpha', 'Team Bravo'].sort()]
);
check('a bye-week (unpaired) entry is dropped rather than crashing', espnNextWeekMatchupPreview([[{ roster_id: 1, points: 0 }]], espnRosters), []);
check('no future week at all produces an empty list rather than throwing', espnNextWeekMatchupPreview(undefined, espnRosters), []);

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

// ============================================================================
// Deriving Yahoo player points from the raw stat line. Yahoo only returns a
// player_points node when the request carries league context; the raw
// player_stats line comes back either way. This is what keeps points real
// regardless of which shape the response takes.
// ============================================================================

const yahooSettings = {
    fantasy_content: {
        league: [
            { league_key: '461.l.999' },
            {
                settings: [{
                    stat_modifiers: {
                        stats: [
                            { stat: { stat_id: '4', value: '0.04' } },   // passing yards
                            { stat: { stat_id: '5', value: '4' } },      // passing TD
                            { stat: { stat_id: '6', value: '-1' } },     // interception
                            { stat: { stat_id: '9', value: '0.1' } },    // rushing yards
                        ],
                    },
                }],
            },
        ],
    },
};

const modifiers = parseYahooStatModifiers(yahooSettings);
check('scoring settings are read off the league settings response', modifiers['5'], 4);
check('a fractional per-unit modifier survives', modifiers['4'], 0.04);
check('a negative modifier survives', modifiers['6'], -1);
check('settings with no modifiers at all produce an empty map rather than throwing', parseYahooStatModifiers({}), {});

// 300 passing yards (12), 2 passing TD (8), 1 INT (-1), 20 rush yards (2) = 21
const statLinePlayer = [
    [{ player_id: '100' }, { name: { full: 'Derivable Player' } }],
    { player_stats: { stats: [
        { stat: { stat_id: '4', value: '300' } },
        { stat: { stat_id: '5', value: '2' } },
        { stat: { stat_id: '6', value: '1' } },
        { stat: { stat_id: '9', value: '20' } },
    ] } },
];
check('points are derived from the raw stat line under the league\'s own scoring', scoreYahooStatLine(statLinePlayer, modifiers), 21);
check('a stat the league does not score is ignored rather than counted as zero-value noise', scoreYahooStatLine([
    [{ player_id: '101' }],
    { player_stats: { stats: [
        { stat: { stat_id: '5', value: '1' } },
        { stat: { stat_id: '9999', value: '50' } },
    ] } },
], modifiers), 4);
check('no stat line at all returns null rather than a fabricated zero', scoreYahooStatLine([[{ player_id: '102' }]], modifiers), null);
check('no scoring settings returns null rather than scoring everything as zero', scoreYahooStatLine(statLinePlayer, {}), null);

// The whole point: an entity with NO player_points still yields real points.
const noPointsNodeRoster = {
    fantasy_content: {
        teams: {
            0: {
                team: [
                    [{ team_key: '461.l.999.t.9' }, { team_id: '9' }, { name: 'Derived Team' }],
                    { roster: { 0: { players: {
                        0: { player: [
                            [
                                { player_key: '461.p.100' },
                                { player_id: '100' },
                                { name: { full: 'Derivable Player' } },
                                { display_position: 'QB' },
                            ],
                            { player_stats: { stats: [
                                { stat: { stat_id: '4', value: '300' } },
                                { stat: { stat_id: '5', value: '2' } },
                                { stat: { stat_id: '6', value: '1' } },
                                { stat: { stat_id: '9', value: '20' } },
                            ] } },
                            { selected_position: [{ coverage_type: 'week' }, { position: 'QB' }] },
                        ] },
                        count: 1,
                    } } } },
                ],
            },
            count: 1,
        },
    },
};
const derivedRows = extractYahooRosterPlayers(noPointsNodeRoster, modifiers);
check(
    'a roster with no player_points node still produces real points instead of 0',
    derivedRows['461.l.999.t.9'][0].actual,
    21
);
check(
    'without scoring settings that same roster falls back to 0 rather than guessing',
    extractYahooRosterPlayers(noPointsNodeRoster, null)['461.l.999.t.9'][0].actual,
    0
);

// --- the narrative payload stays small ---
const payload = narrativePayload(stats);
check('the narrative payload drops the redundant raw games list', payload.games, undefined);
check('the narrative payload keeps the scoreboard it actually reads', Array.isArray(payload.scoreboard), true);
check('the narrative payload is materially smaller than the full stats object', JSON.stringify(payload).length < JSON.stringify(stats).length, true);

// ============================================================================
// Timeout guards. These are what keep a single hung upstream from taking the
// whole invocation down with it (the FUNCTION_INVOCATION_TIMEOUT this
// endpoint was actually dying on), so they're worth holding to directly.
// ============================================================================

const deadlineResolved = await withDeadline(Promise.resolve('done'), 1000, 'fast task');
check('a task that finishes in time passes its value straight through', deadlineResolved, 'done');

let deadlineError = null;
try {
    await withDeadline(new Promise(() => {}), 40, 'stuck task');
} catch (err) {
    deadlineError = err.message;
}
check('a task that never settles rejects rather than hanging forever', typeof deadlineError === 'string' && deadlineError.includes('stuck task'), true);

let rejectionPassedThrough = null;
try {
    await withDeadline(Promise.reject(new Error('real failure')), 1000, 'failing task');
} catch (err) {
    rejectionPassedThrough = err.message;
}
check('a real rejection is surfaced as itself, not masked as a timeout', rejectionPassedThrough, 'real failure');

// fetchWithTimeout against a socket that accepts and then never answers --
// a real hang, which is the case a plain fetch would wait on indefinitely.
const { createServer } = await import('node:http');
const hangingServer = createServer(() => { /* deliberately never responds */ });
await new Promise(resolve => hangingServer.listen(0, '127.0.0.1', resolve));
const hangingUrl = `http://127.0.0.1:${hangingServer.address().port}/`;

let fetchTimeoutError = null;
try {
    await fetchWithTimeout(hangingUrl, {}, 60);
} catch (err) {
    fetchTimeoutError = err.message;
}
hangingServer.close();
check('a request that never answers times out instead of blocking the run', typeof fetchTimeoutError === 'string' && fetchTimeoutError.includes('timed out'), true);

// --- Narrative schema: every story card must be guaranteed a burn. ---
//
// A storyBurns key left out of `required` is not a cosmetic slip -- that is
// precisely how the model came to omit the whole object and ship a story
// where every card rendered bare ("there are still no roasts"). A new card
// added without its key landing in `required` would reintroduce it
// silently, so this asserts the relationship rather than the list.
const burnProps = Object.keys(NARRATIVE_SCHEMA.properties.storyBurns.properties);
const burnRequired = NARRATIVE_SCHEMA.properties.storyBurns.required;
check(
    'every storyBurns key is required, so no story card can render without a burn',
    burnProps.filter(k => !burnRequired.includes(k)),
    []
);
check('the bottom-feeders card has its own burn key', burnProps.includes('bottomFeeders'), true);
check('storyBurns itself is required at the top level', NARRATIVE_SCHEMA.required.includes('storyBurns'), true);

// The leaders/bottom-feeders split (mirrors buildSlides in
// WeeklySummaryStory.jsx, which is JSX and so can't be imported here).
// The case that matters is a league small enough for a naive slice(-5) to
// overlap: a team must never be congratulated on one card and called a
// bottom feeder on the next.
const splitRankings = (ranks) => ({
    leaders: ranks.slice(0, 5),
    bottom: ranks.slice(Math.max(5, ranks.length - 5)),
});

const twelve = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, team: `T${i + 1}` }));
const twelveSplit = splitRankings(twelve);
check('a 12-team league shows the real top 5', twelveSplit.leaders.map(r => r.rank), [1, 2, 3, 4, 5]);
check('a 12-team league shows the real bottom 5', twelveSplit.bottom.map(r => r.rank), [8, 9, 10, 11, 12]);

const eight = Array.from({ length: 8 }, (_, i) => ({ rank: i + 1, team: `T${i + 1}` }));
const eightSplit = splitRankings(eight);
check(
    'an 8-team league never puts the same team on both the leaders and bottom-feeders cards',
    eightSplit.leaders.filter(l => eightSplit.bottom.some(b => b.rank === l.rank)),
    []
);
check('an 8-team league still names its worst teams', eightSplit.bottom.map(r => r.rank), [6, 7, 8]);

const four = Array.from({ length: 4 }, (_, i) => ({ rank: i + 1, team: `T${i + 1}` }));
check('a league smaller than the leaders card gets no bottom-feeders card at all', splitRankings(four).bottom, []);

console.log(`OK: ${checks} weekly-summary checks passed`);
