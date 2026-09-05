// Dependency-free checks for reading a league's history and membership.
// Run with: npm run verify:history
//
// Mostly Yahoo, which can't be reached from here -- so these fixtures are the
// only place its response shapes get exercised. They're written to match its
// real quirks: collections arriving as numbered objects with a `count`,
// entities arriving as arrays of single-key objects, sub-collections hiding
// under a "0" key alongside sibling scalars, and empty elements arriving as
// empty objects rather than null.
//
// Also covers the cross-platform bits that decide who someone is and where
// their league lives, since both platforms are handled side by side.

import {
    yahooCollection,
    yahooField,
    parseYahooStandings,
    buildPodiumFromStandings,
    parseYahooScoreboard,
    groupPlayoffRounds,
    isSameLeagueChain,
    parseYahooDraftResults,
    buildYahooDraftBoard,
    parseYahooUserLeagueKeys,
    isKeyInUserLeagues,
    assignManagerIdentities,
    parseYahooOwnTeams,
    parseYahooPlayers,
    parseYahooTeamPlayerPoints,
    parseYahooTransactions,
    weekFromTimestamp,
    yahooText,
} from '../src/utils/yahooHistory.js';
import { getPlatformLink } from '../src/utils/platformLinks.js';
import { findSleeperLeagueUser, isSleeperCommissioner } from '../src/utils/leagueMembership.js';
import { describeLeagueWrite } from '../src/utils/dbWrite.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
    const ok = got === want;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
    ok ? pass++ : fail++;
};

// --- Shape helpers -------------------------------------------------------
eq('numbered-object collection drops count', yahooCollection({ 0: 'a', 1: 'b', count: 2 }).length, 2);
eq('array collection passes through', yahooCollection(['a', 'b']).length, 2);
eq('missing collection is empty', yahooCollection(null).length, 0);
eq('field found in entity array', yahooField([{ team_id: '4' }, { name: 'X' }], 'name'), 'X');
eq('missing field is undefined', yahooField([{ team_id: '4' }], 'nope'), undefined);

// --- Standings -----------------------------------------------------------
const team = (id, rank, guid, opts = {}) => ({
    team: [
        [
            { team_key: `461.l.999.t.${id}` },
            { team_id: String(id) },
            { name: `Team ${id}` },
            { is_owned_by_current_login: opts.mine ? '1' : '0' },
            { managers: { 0: { manager: { manager_id: String(id), nickname: `Mgr ${id}`, guid } }, count: 1 } },
        ],
        {
            team_standings: {
                rank: String(rank),
                playoff_seed: String(rank),
                outcome_totals: { wins: String(opts.wins ?? 10), losses: '4', ties: '0' },
                points_for: String(opts.pf ?? 1500.5),
                points_against: '1400.25',
                streak: { value: '2' },
            },
        },
    ],
});

const standingsPayload = {
    fantasy_content: {
        league: [
            { league_key: '461.l.999', season: '2024' },
            {
                standings: [
                    {
                        teams: {
                            0: team(1, 3, 'GUID-C'),
                            1: team(2, 1, 'GUID-A', { mine: true, pf: 1700.75 }),
                            2: team(3, 2, 'GUID-B'),
                            3: team(4, 4, 'GUID-D'),
                            count: 4,
                        },
                    },
                ],
            },
        ],
    },
};

const rows = parseYahooStandings(standingsPayload);
eq('every team parsed', rows.length, 4);
eq('roster id is the numeric team id', rows[0].rosterId, 1);
eq('points parsed as a number', rows[1].pointsFor, 1700.75);
eq('the requesting user\'s team is flagged', rows.find(r => r.isOwnedByCurrentLogin)?.rosterId, 2);

// The whole reason this field exists: a team_key is season-scoped, a guid is
// not. Keying a manager by team_key makes each season look like new people and
// no all-time record ever accumulates.
eq('manager identity is the stable guid', rows[1].managerGuids[0], 'GUID-A');
eq('team key kept separately', rows[1].teamKey, '461.l.999.t.2');

// --- Podium --------------------------------------------------------------
const podium = buildPodiumFromStandings(rows, 2024);
eq('champion is rank 1', podium.champion, 2);
eq('runner-up is rank 2', podium.second, 3);
eq('third is rank 3', podium.third, 1);
eq('toilet is last place', podium.toilet, 4);
eq('year carried through', podium.year, 2024);
eq('no divisions configured -> none reported', podium.divisions.length, 0);

eq('no ranks at all -> no podium', buildPodiumFromStandings([{ rosterId: 1, rank: null }], 2024), null);
eq('empty standings -> no podium', buildPodiumFromStandings([], 2024), null);
// A 2-team result shouldn't claim a wooden spoon that overlaps the podium.
eq('too few teams -> no toilet bowl',
    buildPodiumFromStandings([{ rosterId: 1, rank: 1 }, { rosterId: 2, rank: 2 }], 2024).toilet, undefined);

// --- Manager identity ----------------------------------------------------
// This is the bug that merged an entire league into one manager. Yahoo's JSON
// comes from XML, and an EMPTY element arrives as an empty OBJECT: <guid/> is
// {} , not "" or null. {} is truthy, so it sailed through a Boolean filter and
// became every team's identity -- and an object used as a key stringifies to
// "[object Object]", the same for all ten teams. One bucket got the league's
// entire win AND loss total, and every manager inherited the champion's ring.
eq('an empty Yahoo element is not a usable string', yahooText({}), null);
eq('a real string is kept', yahooText('ABC123'), 'ABC123');
eq('whitespace is not an identity', yahooText('   '), null);
eq('null is not an identity', yahooText(null), null);
eq('an array is not an identity', yahooText([]), null);

const teamWithEmptyGuid = (id) => ({
    team: [[
        { team_key: `470.l.604026.t.${id}` },
        { team_id: String(id) },
        { name: `Team ${id}` },
        // Exactly what Yahoo sends when the guid element is empty.
        { managers: { 0: { manager: { manager_id: String(id), nickname: `Mgr ${id}`, guid: {} } }, count: 1 } },
    ], { team_standings: { rank: String(id), outcome_totals: { wins: '8', losses: '7', ties: '0' }, points_for: '1500' } }],
});

const emptyGuidRows = parseYahooStandings({
    fantasy_content: { league: [{ league_key: '470.l.604026' }, { standings: [{ teams: {
        0: teamWithEmptyGuid(1), 1: teamWithEmptyGuid(2), 2: teamWithEmptyGuid(3), count: 3,
    } }] }] },
});
eq('empty guids yield no guids at all', emptyGuidRows.every(r => r.managerGuids.length === 0), true);

const emptyGuidIds = assignManagerIdentities(emptyGuidRows);
eq('identity falls back off unusable guids', emptyGuidIds.source, 'nickname');
// The load-bearing assertion: three teams must be three managers, never one.
eq('three teams stay three distinct managers',
    new Set([...emptyGuidIds.byRosterId.values()].map(ids => ids[0])).size, 3);

// Real guids are preferred -- they're the only id stable across seasons.
const goodIds = assignManagerIdentities(rows);
eq('real guids are used when present', goodIds.source, 'guid');
eq('each team keeps its own guid', goodIds.byRosterId.get(2)[0], 'GUID-A');

// Yahoo hides some managers behind a shared placeholder nickname; that can't
// identify anyone either, so it has to fall through to the team key.
const hiddenRows = [1, 2, 3].map(id => ({
    rosterId: id, teamKey: `470.l.604026.t.${id}`, managerGuids: [], managerNicknames: ['--hidden--'],
}));
const hiddenIds = assignManagerIdentities(hiddenRows);
eq('a shared placeholder nickname is not an identity', hiddenIds.source, 'team_key');
eq('hidden managers still stay distinct',
    new Set([...hiddenIds.byRosterId.values()].map(ids => ids[0])).size, 3);

// Nothing usable at all still must not collapse.
const barren = assignManagerIdentities([{ rosterId: 1 }, { rosterId: 2 }]);
eq('with nothing usable, roster ids keep teams apart', barren.source, 'roster_id');
eq('and they are still distinct',
    new Set([...barren.byRosterId.values()].map(ids => ids[0])).size, 2);
eq('no teams -> nothing to identify', assignManagerIdentities([]).byRosterId.size, 0);

// --- Season chain integrity ----------------------------------------------
// A bad renew pointer isn't a visible failure: it splices another league's
// teams, champions and records into this league's history. These are the
// checks that stop the walk instead.
const season = (league_id, yr, renewed_league_id = null) => ({ league_id, season: String(yr), renewed_league_id });

eq('a genuine previous season is accepted',
    isSameLeagueChain(season('423.l.999', 2024, '461.l.123'), season('461.l.123', 2025)), true);
eq('a missing forward pointer is accepted (Yahoo omits it on older leagues)',
    isSameLeagueChain(season('423.l.999', 2024), season('461.l.123', 2025)), true);
eq('a forward pointer naming a DIFFERENT league is rejected',
    isSameLeagueChain(season('423.l.999', 2024, '461.l.777'), season('461.l.123', 2025)), false);
eq('a "previous" season that is not older is rejected',
    isSameLeagueChain(season('461.l.777', 2025), season('461.l.123', 2025)), false);
eq('a "previous" season from the future is rejected',
    isSameLeagueChain(season('461.l.777', 2026), season('461.l.123', 2025)), false);
eq('a missing season is rejected', isSameLeagueChain(null, season('461.l.123', 2025)), false);

// --- Which leagues does this account actually belong to? -----------------
// A renew chain describes the LEAGUE's lineage, not the user's: an eleven-year
// league whose account joined last year would otherwise report ten seasons of
// "all-time" records the user was never part of.
const userLeaguesPayload = {
    fantasy_content: {
        users: {
            0: {
                user: [
                    { guid: 'MY-GUID' },
                    {
                        games: {
                            0: { game: [{ game_key: '461', season: '2025' }, { leagues: {
                                0: { league: [{ league_key: '461.l.123', name: 'This League' }] },
                                count: 1,
                            } }] },
                            1: { game: [{ game_key: '449', season: '2024' }, { leagues: {
                                0: { league: [{ league_key: '449.l.555', name: 'Another League' }] },
                                count: 1,
                            } }] },
                            count: 2,
                        },
                    },
                ],
            },
            count: 1,
        },
    },
};

const myLeagues = parseYahooUserLeagueKeys(userLeaguesPayload);
eq('league keys collected across every season', myLeagues.size, 2);
eq('this season\'s league is present', myLeagues.has('461.l.123'), true);
eq('a season the user IS in is accepted', isKeyInUserLeagues('449.l.555', myLeagues), true);
// The one that matters: a renew pointer at a season the user never played in.
eq('a season the user is NOT in is rejected', isKeyInUserLeagues('423.l.999', myLeagues), false);
// A stored id can be the alias form; that's still this league.
eq('the nfl alias matches on league id', isKeyInUserLeagues('nfl.l.123', myLeagues), true);
eq('the alias does not match an unrelated id', isKeyInUserLeagues('nfl.l.999', myLeagues), false);
eq('an unknown list blocks nothing here', isKeyInUserLeagues('461.l.123', new Set()), false);
eq('no leagues parsed from junk', parseYahooUserLeagueKeys({}).size, 0);

// --- Scoreboard ----------------------------------------------------------
const sbTeam = (id, points, projected) => ({
    team: [
        [{ team_key: `461.l.999.t.${id}` }, { team_id: String(id) }, { name: `Team ${id}` }],
        { team_points: { coverage_type: 'week', week: '1', total: String(points) } },
        ...(projected === undefined ? [] : [{ team_projected_points: { coverage_type: 'week', week: '1', total: String(projected) } }]),
    ],
});

const matchup = ({ week, status, playoffs = 0, consolation = 0, a, b }) => ({
    matchup: {
        0: { teams: { 0: sbTeam(a[0], a[1], a[2]), 1: sbTeam(b[0], b[1], b[2]), count: 2 } },
        week: String(week),
        status,
        is_playoffs: String(playoffs),
        is_consolation: String(consolation),
        winner_team_key: `461.l.999.t.${a[1] >= b[1] ? a[0] : b[0]}`,
    },
});

const scoreboardPayload = {
    fantasy_content: {
        league: [
            { league_key: '461.l.999' },
            {
                scoreboard: {
                    0: {
                        matchups: {
                            0: matchup({ week: 1, status: 'postevent', a: [1, 120.5, 133.60], b: [2, 99.25, 133.58] }),
                            1: matchup({ week: 2, status: 'postevent', a: [3, 88], b: [4, 101] }),
                            // Not played yet: Yahoo still returns the pairing, at 0-0.
                            2: matchup({ week: 3, status: 'preevent', a: [1, 0], b: [3, 0] }),
                            count: 3,
                        },
                    },
                    week: '1',
                },
            },
        ],
    },
};

const sb = parseYahooScoreboard(scoreboardPayload);
eq('all matchups parsed', sb.length, 3);
eq('week read off the matchup, not the request', sb[1].week, 2);
eq('points parsed', sb[0].teams[0].points, 120.5);
eq('roster ids parsed', sb[0].teams[1].roster_id, 2);
eq('finished matchup is marked played', sb[0].played, true);
// This is the one that keeps a 0-0 future week out of the "lowest score" records.
eq('unplayed matchup is not marked played', sb[2].played, false);
eq('missing scoreboard -> nothing', parseYahooScoreboard({}).length, 0);

// Yahoo publishes a projected total per TEAM (not per player), and it's the
// number the manager sees in Yahoo -- so the matchup header can match it
// instead of showing a different model's sum.
eq('the team projection is read', sb[0].teams[0].projected_points, 133.6);
eq('both sides get one', sb[0].teams[1].projected_points, 133.58);
// Absent is null, not 0 -- a real 0.00 projection and "not published" are
// different things, and the caller falls back to summing starters on null.
eq('no projection published -> null', sb[1].teams[0].projected_points, null);

// A league with no status field: fall back to whether anyone actually scored.
const noStatus = parseYahooScoreboard({
    fantasy_content: { league: [{}, { scoreboard: { 0: { matchups: { 0: matchup({ week: 5, status: undefined, a: [1, 110], b: [2, 95] }), count: 1 } } } }] },
});
eq('no status -> played inferred from points', noStatus[0].played, true);

// --- Playoff rounds ------------------------------------------------------
const playoffPayload = {
    fantasy_content: {
        league: [
            {},
            {
                scoreboard: {
                    0: {
                        matchups: {
                            0: matchup({ week: 15, status: 'postevent', playoffs: 1, a: [1, 120], b: [4, 100] }),
                            1: matchup({ week: 15, status: 'postevent', playoffs: 1, a: [2, 130], b: [3, 90] }),
                            2: matchup({ week: 15, status: 'postevent', playoffs: 1, consolation: 1, a: [5, 80], b: [6, 70] }),
                            3: matchup({ week: 16, status: 'postevent', playoffs: 1, a: [1, 140], b: [2, 110] }),
                            4: matchup({ week: 17, status: 'preevent', playoffs: 1, a: [1, 0], b: [2, 0] }),
                            5: matchup({ week: 14, status: 'postevent', playoffs: 0, a: [1, 95], b: [2, 92] }),
                            count: 6,
                        },
                    },
                },
            },
        ],
    },
};

const rounds = groupPlayoffRounds(parseYahooScoreboard(playoffPayload));
eq('regular-season and unplayed games excluded', rounds.length, 3);
eq('first round is week 15 championship', rounds[0].week, 15);
eq('semifinal week holds both games', rounds[0].matchups.length, 2);
eq('consolation kept in its own group', rounds[1].consolation, true);
eq('championship rounds counted without consolation', rounds[0].totalRounds, 2);
// The final championship week has to land on the last round index so it gets
// labelled "Finals" rather than a qualifier.
const finals = rounds.find(r => !r.consolation && r.week === 16);
eq('final week is the last round', finals.roundIndex, finals.totalRounds - 1);
eq('no playoff games -> no rounds', groupPlayoffRounds(sb).length, 0);

// --- Draft results -------------------------------------------------------
// A 4-team snake: round 1 runs 1,2,3,4 and round 2 runs back 4,3,2,1.
const draftResult = (pick, round, teamId, playerId, cost) => ({
    draft_result: {
        pick: String(pick),
        round: String(round),
        team_key: `461.l.999.t.${teamId}`,
        player_key: `461.p.${playerId}`,
        ...(cost !== undefined ? { cost: String(cost) } : {}),
    },
});

const snakePayload = {
    fantasy_content: {
        league: [
            { league_key: '461.l.999', season: '2024' },
            {
                draft_results: {
                    0: draftResult(1, 1, 1, 100),
                    1: draftResult(2, 1, 2, 200),
                    2: draftResult(3, 1, 3, 300),
                    3: draftResult(4, 1, 4, 400),
                    4: draftResult(5, 2, 4, 500),
                    5: draftResult(6, 2, 3, 600),
                    6: draftResult(7, 2, 2, 700),
                    7: draftResult(8, 2, 1, 800),
                    count: 8,
                },
            },
        ],
    },
};

const draftPicks = parseYahooDraftResults(snakePayload);
eq('every pick parsed', draftPicks.length, 8);
eq('roster id pulled from the team key', draftPicks[0].rosterId, 1);
eq('player id pulled from the player key', draftPicks[0].playerId, '100');
eq('picks come back in draft order', draftPicks[4].pick, 5);

const board = buildYahooDraftBoard(draftPicks, { leagueKey: '461.l.999', season: '2024' });
eq('team count derived from round one', board.settings.teams, 4);
eq('rounds derived from the picks', board.settings.rounds, 2);
eq('snake order detected from the data, not assumed', board.type, 'snake');
eq('slot map built from round one', board.slot_to_roster_id[1], 1);
eq('last slot of round one', board.slot_to_roster_id[4], 4);
// The point of the snake handling: pick 5 belongs to the team in the LAST
// column, so it must land there rather than in column one.
eq('first pick of a reversed round sits in the last column',
    board.picks.find(p => p.pick_no === 5).draft_slot, 4);
eq('last pick of a reversed round sits in the first column',
    board.picks.find(p => p.pick_no === 8).draft_slot, 1);
eq('round one is left to right', board.picks.find(p => p.pick_no === 3).draft_slot, 3);
eq('the drafting team is kept on the pick', board.picks.find(p => p.pick_no === 5).roster_id, 4);

// A linear draft repeats the same order; mirroring its even rounds would put
// every pick in the wrong column.
const linearPayload = {
    fantasy_content: {
        league: [{}, { draft_results: {
            0: draftResult(1, 1, 1, 100), 1: draftResult(2, 1, 2, 200),
            2: draftResult(3, 2, 1, 300), 3: draftResult(4, 2, 2, 400), count: 4,
        } }],
    },
};
const linearBoard = buildYahooDraftBoard(parseYahooDraftResults(linearPayload), { leagueKey: 'x', season: '2024' });
eq('a repeating order is read as linear', linearBoard.type, 'linear');
eq('linear round two is not mirrored',
    linearBoard.picks.find(p => p.pick_no === 3).draft_slot, 1);

// Auction: costs come through and the order carries no meaning.
const auctionPayload = {
    fantasy_content: {
        league: [{}, { draft_results: {
            0: draftResult(1, 1, 1, 100, 45), 1: draftResult(2, 1, 2, 200, 12), count: 2,
        } }],
    },
};
const auctionPicks = parseYahooDraftResults(auctionPayload);
eq('auction cost parsed', auctionPicks[0].cost, 45);
eq('auction board is typed as auction',
    buildYahooDraftBoard(auctionPicks, { leagueKey: 'x', season: '2024', isAuction: true }).type, 'auction');
eq('no picks -> no board', buildYahooDraftBoard([], { leagueKey: 'x' }), null);
eq('missing draft results -> nothing', parseYahooDraftResults({}).length, 0);

// --- The account's own team, and whether it runs the league ----------------
// Yahoo describes every team in a league identically; the only place it says
// "this one is yours" -- and whether you're the commissioner -- is the teams
// collection for the logged-in user.
const ownTeamsPayload = {
    fantasy_content: {
        users: {
            0: {
                user: [
                    { guid: 'MY-GUID' },
                    {
                        games: {
                            0: {
                                game: [{ game_key: '470' }, {
                                    teams: {
                                        0: { team: [[
                                            { team_key: '470.l.604026.t.6' },
                                            { name: 'Straw Hat Pirates' },
                                            { managers: { 0: { manager: { nickname: 'Me', guid: 'MY-GUID', is_commissioner: '1' } }, count: 1 } },
                                        ]] },
                                        1: { team: [[
                                            { team_key: '470.l.111111.t.2' },
                                            { name: 'Other Team' },
                                            { managers: { 0: { manager: { nickname: 'Me', guid: 'MY-GUID' } }, count: 1 } },
                                        ]] },
                                        count: 2,
                                    },
                                }],
                            },
                            count: 1,
                        },
                    },
                ],
            },
            count: 1,
        },
    },
};

const ownTeams = parseYahooOwnTeams(ownTeamsPayload);
eq('own team found per league', Object.keys(ownTeams).length, 2);
eq('keyed by league, not team', !!ownTeams['470.l.604026'], true);
eq('own team name captured', ownTeams['470.l.604026'].teamName, 'Straw Hat Pirates');
// The whole reason for this parse: commissioner tools were hidden from every
// Yahoo connection because nothing ever read this flag.
eq('commissioner flag read from the manager', ownTeams['470.l.604026'].isCommissioner, true);
eq('a non-commissioner is not promoted', ownTeams['470.l.111111'].isCommissioner, false);
eq('junk yields no teams', Object.keys(parseYahooOwnTeams({})).length, 0);

// --- Player details --------------------------------------------------------
// Draft picks name players only by key, and Sleeper's yahoo_id crosswalk misses
// plenty of them -- which is what rendered most of a Yahoo draft board as
// "Unknown". These come straight from Yahoo.
const playersPayload = {
    fantasy_content: {
        league: [{ league_key: '470.l.604026' }, {
            players: {
                0: { player: [[
                    { player_key: '470.p.31883' },
                    { player_id: '31883' },
                    { name: { full: 'CeeDee Lamb', first: 'CeeDee', last: 'Lamb' } },
                    { editorial_team_abbr: 'dal' },
                    { display_position: 'WR' },
                    { headshot: { url: 'https://s.yimg.com/lamb.png' } },
                ]] },
                1: { player: [[
                    { player_key: '470.p.100022' },
                    { player_id: '100022' },
                    { name: { full: 'San Francisco', first: 'San Francisco', last: '' } },
                    { editorial_team_abbr: 'sf' },
                    { display_position: 'DEF' },
                ]] },
                count: 2,
            },
        }],
    },
};

const yahooPlayers = parseYahooPlayers(playersPayload);
eq('players parsed', yahooPlayers.length, 2);
eq('keyed by the id picks refer to', yahooPlayers[0].id, '31883');
eq('first name kept', yahooPlayers[0].fn, 'CeeDee');
eq('last name kept', yahooPlayers[0].ln, 'Lamb');
eq('team normalised to upper case', yahooPlayers[0].t, 'DAL');
eq('position kept', yahooPlayers[0].pos, 'WR');
eq('headshot kept for players the crosswalk misses', yahooPlayers[0].headshot, 'https://s.yimg.com/lamb.png');
eq('a defense still parses', yahooPlayers[1].pos, 'DEF');
eq('no headshot -> null, not an empty object', yahooPlayers[1].headshot, null);
eq('draft picks keep their full player key',
    parseYahooDraftResults(snakePayload)[0].playerKey, '461.p.100');

// --- Platform links --------------------------------------------------------
eq('a yahoo league links to Yahoo',
    getPlatformLink({ platform: 'yahoo', sleeper_league_id: '470.l.604026' }).url,
    'https://football.fantasysports.yahoo.com/f1/604026');
eq('and is labelled for Yahoo',
    getPlatformLink({ platform: 'yahoo', sleeper_league_id: '470.l.604026' }).label, 'Go to Yahoo');
eq('the nfl alias resolves to the same league id',
    getPlatformLink({ sleeper_league_id: 'nfl.l.604026' }).url,
    'https://football.fantasysports.yahoo.com/f1/604026');
eq('a sleeper league still links to Sleeper',
    getPlatformLink({ platform: 'sleeper', sleeper_league_id: '1312102318602207232' }).url,
    'https://sleeper.app/leagues/1312102318602207232');
eq('a numeric id is read as Sleeper',
    getPlatformLink({ sleeper_league_id: '1312102318602207232' }).platform, 'sleeper');
eq('no league -> no crash', getPlatformLink(null).label, 'Go to Sleeper');

// --- Finding the connected account in a Sleeper league ---------------------
// Sleeper returns every member of a league identically -- there's no "my team"
// endpoint the way Yahoo has -- so the account has to be picked out. Getting
// this wrong hands commissioner tools to the wrong person.
const sleeperUsers = [
    { user_id: '111', display_name: 'GunnerA', is_owner: true, metadata: { team_name: 'Straw Hat Pirates' } },
    { user_id: '222', display_name: 'thomas', metadata: { team_name: 'Trumpy Trouts' } },
    { user_id: '333', display_name: 'thomas', metadata: { team_name: 'Dakstreet Boys' } },
];

eq('the user id is an exact match',
    findSleeperLeagueUser(sleeperUsers, { userId: '222' })?.metadata.team_name, 'Trumpy Trouts');
eq('a unique display name matches',
    findSleeperLeagueUser(sleeperUsers, { teamName: 'GunnerA' })?.user_id, '111');
eq('a team name matches too',
    findSleeperLeagueUser(sleeperUsers, { teamName: 'Dakstreet Boys' })?.user_id, '333');
eq('matching ignores case and spacing',
    findSleeperLeagueUser(sleeperUsers, { teamName: '  straw   hat pirates ' })?.user_id, '111');
// The one that matters: two members share "thomas", so a name alone can't say
// which is the account -- guessing could hand over commissioner tools.
eq('an ambiguous name is not guessed at',
    findSleeperLeagueUser(sleeperUsers, { teamName: 'thomas' }), null);
eq('the id wins over an ambiguous name',
    findSleeperLeagueUser(sleeperUsers, { userId: '333', teamName: 'thomas' })?.user_id, '333');
eq('an unknown name matches nobody',
    findSleeperLeagueUser(sleeperUsers, { teamName: 'Nobody' }), null);
eq('no members -> nobody', findSleeperLeagueUser([], { userId: '111' }), null);
eq('malformed input -> nobody', findSleeperLeagueUser(null, { userId: '111' }), null);

eq('the league owner is the commissioner', isSleeperCommissioner(sleeperUsers[0]), true);
eq('a regular member is not', isSleeperCommissioner(sleeperUsers[1]), false);
eq('nobody is not a commissioner', isSleeperCommissioner(null), false);

// --- Did a settings save actually save? ------------------------------------
// Supabase reports SUCCESS for an update that matched no rows: `error` is null
// and the statement was valid, it just changed nothing -- which is what a
// row-level security policy produces. Checking only `error` is how a settings
// screen ends up saying "Saved!" while the database is untouched.
eq('a real write is a success', describeLeagueWrite(null, 1).ok, true);
eq('a database error is a failure', describeLeagueWrite({ message: 'boom' }, 0).ok, false);
eq('the error message is surfaced', describeLeagueWrite({ message: 'boom' }, 0).message.includes('boom'), true);
// The load-bearing one: no error, but nothing written.
eq('changing no rows is NOT a success', describeLeagueWrite(null, 0).ok, false);
eq('and says why', describeLeagueWrite(null, 0).message.includes('permission'), true);

// --- Actual points, per player ---------------------------------------------
// Projections and actuals are different problems. Yahoo publishes no per-player
// PROJECTION through its API, but it does publish actual points -- which makes
// them exact, with no scoring rules to re-derive and no crosswalk to miss.
// Without reading them, every player in a Yahoo matchup sits at 0.00 all season
// beside a team total that moves.
const scoredPlayer = (id, total) => ({
    player: [
        [{ player_key: `470.p.${id}` }, { player_id: String(id) }, { name: { full: `Player ${id}` } }],
        ...(total === undefined ? [] : [{ player_points: { coverage_type: 'week', week: '1', total: String(total) } }]),
    ],
});

const rosterPointsPayload = {
    fantasy_content: {
        teams: {
            0: {
                team: [
                    [{ team_key: '470.l.604026.t.6' }, { team_id: '6' }, { name: 'Straw Hat Pirates' }],
                    { roster: { 0: { players: { 0: scoredPlayer(31883, 18.4), 1: scoredPlayer(30977, 0), count: 2 } } } },
                ],
            },
            1: {
                team: [
                    [{ team_key: '470.l.604026.t.2' }, { team_id: '2' }, { name: 'Obi-Dak Kenobi' }],
                    { roster: { 0: { players: { 0: scoredPlayer(28392, 7.25), count: 1 } } } },
                ],
            },
            count: 2,
        },
    },
};

const teamPoints = parseYahooTeamPlayerPoints(rosterPointsPayload);
eq('points come back keyed by team', Object.keys(teamPoints).length, 2);
eq('a player\'s actual points are read', teamPoints['470.l.604026.t.6']['31883'], 18.4);
// A genuine zero must survive: it means "played, scored nothing", which is not
// the same as the blanket 0.00 this replaces.
eq('a real zero is kept', teamPoints['470.l.604026.t.6']['30977'], 0);
eq('the other team is separate', teamPoints['470.l.604026.t.2']['28392'], 7.25);
eq('teams do not bleed into each other', teamPoints['470.l.604026.t.2']['31883'], undefined);
eq('junk yields nothing', Object.keys(parseYahooTeamPlayerPoints({})).length, 0);

// --- Transactions ----------------------------------------------------------
// Yahoo leagues showed no transactions at all, because the page asked Sleeper
// for them using a Yahoo league key. These are the shape traps in Yahoo's own
// feed: transaction_data arrives as an object OR an array of them, and an add
// names its DESTINATION team while a drop names its SOURCE -- read only one and
// half of every add/drop disappears.
const txnPlayer = (playerId, moves) => ({
    player: [
        [{ player_key: `470.p.${playerId}` }, { player_id: String(playerId) }, { name: { full: `Player ${playerId}` } }],
        { transaction_data: moves },
    ],
});

const transactionsPayload = {
    fantasy_content: {
        league: [{ league_key: '470.l.604026' }, {
            transactions: {
                // An add/drop pair: one player in, one out, same team.
                0: { transaction: [
                    { transaction_key: '470.l.604026.tr.1', transaction_id: '1', type: 'add/drop', status: 'successful', timestamp: '1757462400', faab_bid: '7' },
                    { players: {
                        0: txnPlayer(31883, [{ type: 'add', source_type: 'waivers', destination_type: 'team', destination_team_key: '470.l.604026.t.6' }]),
                        1: txnPlayer(30977, { type: 'drop', source_type: 'team', source_team_key: '470.l.604026.t.6', destination_type: 'waivers' }),
                        count: 2,
                    } },
                ] },
                // A straight free-agent add, no bid.
                1: { transaction: [
                    { transaction_id: '2', type: 'add', status: 'successful', timestamp: '1757376000' },
                    { players: { 0: txnPlayer(28392, { type: 'add', source_type: 'freeagents', destination_type: 'team', destination_team_key: '470.l.604026.t.2' }), count: 1 } },
                ] },
                // A failed waiver claim, which Yahoo keeps in the same feed.
                2: { transaction: [
                    { transaction_id: '3', type: 'add', status: 'failed', timestamp: '1757300000' },
                    { players: { 0: txnPlayer(11111, { type: 'add', destination_team_key: '470.l.604026.t.3' }), count: 1 } },
                ] },
                count: 3,
            },
        }],
    },
};

const txns = parseYahooTransactions(transactionsPayload);
eq('failed claims are left out', txns.length, 2);
eq('newest first', txns[0].transaction_id, '1');
// The array form of transaction_data.
eq('an add is credited to its destination team', txns[0].adds['31883'], 6);
// The object form -- and a drop names its SOURCE, not its destination.
eq('a drop is credited to its source team', txns[0].drops['30977'], 6);
eq('both sides land on one roster id', txns[0].roster_ids.length, 1);
eq('a bid makes it a waiver', txns[0].type, 'waiver');
eq('the bid is kept', txns[0].settings.waiver_bid, 7);
eq('no bid and no waiver source is a free agent pickup', txns[1].type, 'free_agent');
eq('a pure add has no drops', txns[1].drops, null);
// Yahoo counts seconds; the views format milliseconds.
eq('timestamps are converted to milliseconds', txns[0].status_updated, 1757462400000);
eq('junk yields nothing', parseYahooTransactions({}).length, 0);
// The player keys ride along so the names can be looked up -- without them a
// transaction can only render a bare id.
eq('player keys are kept for lookup', txns[0].player_keys.length, 2);
eq('and are the full yahoo keys', txns[0].player_keys[0], '470.p.31883');

// Yahoo never says which WEEK a transaction belongs to, only when it happened.
const seasonStart = Date.parse('2025-09-04T00:00:00Z');
eq('the season opener is week 1', weekFromTimestamp(seasonStart, seasonStart, 1), 1);
eq('six days in is still week 1', weekFromTimestamp(seasonStart + 6 * 86400000, seasonStart, 1), 1);
eq('seven days in is week 2', weekFromTimestamp(seasonStart + 7 * 86400000, seasonStart, 1), 2);
eq('mid-season lands right', weekFromTimestamp(seasonStart + 35 * 86400000, seasonStart, 1), 6);
// Pre-season pickups belong to the first week, not week zero or negative.
eq('a pre-season move is week 1', weekFromTimestamp(seasonStart - 86400000, seasonStart, 1), 1);
eq('a league starting later is respected', weekFromTimestamp(seasonStart, seasonStart, 2), 2);
eq('no season start -> no week', weekFromTimestamp(seasonStart, null, 1), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
