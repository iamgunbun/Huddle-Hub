// Dependency-free checks for the Yahoo league-history parsing.
// Run with: npm run verify:history
//
// Yahoo can't be reached from here, so these fixtures are the only place the
// response shapes get exercised. They're written to match Yahoo's real quirks:
// collections arriving as numbered objects with a `count`, entities arriving as
// arrays of single-key objects, and sub-collections hiding under a "0" key
// alongside sibling scalars.

import {
    yahooCollection,
    yahooField,
    parseYahooStandings,
    buildPodiumFromStandings,
    parseYahooScoreboard,
    groupPlayoffRounds,
} from '../src/utils/yahooHistory.js';

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

// --- Scoreboard ----------------------------------------------------------
const sbTeam = (id, points) => ({
    team: [
        [{ team_key: `461.l.999.t.${id}` }, { team_id: String(id) }, { name: `Team ${id}` }],
        { team_points: { coverage_type: 'week', week: '1', total: String(points) } },
    ],
});

const matchup = ({ week, status, playoffs = 0, consolation = 0, a, b }) => ({
    matchup: {
        0: { teams: { 0: sbTeam(a[0], a[1]), 1: sbTeam(b[0], b[1]), count: 2 } },
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
                            0: matchup({ week: 1, status: 'postevent', a: [1, 120.5], b: [2, 99.25] }),
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
