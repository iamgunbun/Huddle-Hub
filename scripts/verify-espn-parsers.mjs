import assert from 'node:assert/strict';
import {
    espnProTeamAbbr,
    espnPositionName,
    isEspnStarterSlot,
    isEspnReserveSlot,
    espnHeadshotUrl,
    espnTeamDisplayName,
    parseEspnRosterEntry,
    parseEspnTeamRoster,
    parseEspnLeagueRosters,
    parseEspnSchedule,
    parseEspnTransactions,
    parseEspnDraftDetail,
} from '../src/utils/espnParsers.js';

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

// --- basic maps ---
check('proTeamId 25 is SF', espnProTeamAbbr(25), 'SF');
check('unknown proTeamId falls back to FA', espnProTeamAbbr(999), 'FA');
check('defaultPositionId 2 is RB', espnPositionName(2), 'RB');
check('defaultPositionId 16 is DEF', espnPositionName(16), 'DEF');
check('unknown position falls back to BN', espnPositionName(999), 'BN');
check('bench slot (20) is not a starter', isEspnStarterSlot(20), false);
check('IR slot (21) is not a starter', isEspnStarterSlot(21), false);
check('IR slot is reserve', isEspnReserveSlot(21), true);
check('a flex slot (23) is a starter', isEspnStarterSlot(23), true);
check('headshot url is built from the id', espnHeadshotUrl('12345'), 'https://a.espncdn.com/i/headshots/nfl/players/full/12345.png');
check('no id -> no headshot url', espnHeadshotUrl(null), null);
check('team name prefers the explicit name field', espnTeamDisplayName({ id: 1, name: 'The Bengals of Fortune' }), 'The Bengals of Fortune');
check('team name falls back to location + nickname', espnTeamDisplayName({ id: 2, location: 'Team', nickname: 'Two' }), 'Team Two');
check('team name falls back to a generic label', espnTeamDisplayName({ id: 3 }), 'Team 3');

// --- parseEspnRosterEntry ---
const starterEntry = {
    playerId: 4000,
    lineupSlotId: 2, // RB starter slot
    playerPoolEntry: {
        player: {
            id: 4000,
            firstName: 'Test',
            lastName: 'Runner',
            fullName: 'Test Runner',
            defaultPositionId: 2,
            proTeamId: 25,
            injuryStatus: 'ACTIVE',
            stats: [
                { scoringPeriodId: 3, statSourceId: 0, appliedTotal: 18.4 },
                { scoringPeriodId: 3, statSourceId: 1, appliedTotal: 15.2 },
            ],
        },
    },
};
const parsedStarter = parseEspnRosterEntry(starterEntry, 3);
check('roster entry resolves the player id', parsedStarter.id, '4000');
check('roster entry resolves name', [parsedStarter.fn, parsedStarter.ln], ['Test', 'Runner']);
check('roster entry resolves position', parsedStarter.pos, 'RB');
check('roster entry resolves team', parsedStarter.t, 'SF');
check('roster entry is flagged a starter', parsedStarter.isStarter, true);
check('roster entry is not reserve', parsedStarter.isReserve, false);
check('roster entry resolves actual points for the requested week', parsedStarter.actualPoints, 18.4);
check('roster entry resolves projected points for the requested week', parsedStarter.projectedPoints, 15.2);
check('an active player has no injury status', parsedStarter.injStatus, null);

const benchEntry = {
    playerId: 5000,
    lineupSlotId: 20,
    playerPoolEntry: { player: { id: 5000, firstName: 'Bench', lastName: 'Guy', defaultPositionId: 3, proTeamId: 0, injuryStatus: 'QUESTIONABLE', stats: [] } },
};
const parsedBench = parseEspnRosterEntry(benchEntry);
check('a bench slot is not a starter', parsedBench.isStarter, false);
check('a questionable player carries the status', parsedBench.injStatus, 'QUESTIONABLE');
check('no week requested -> no points resolved', parsedBench.actualPoints, null);

check('a missing player entry resolves to null', parseEspnRosterEntry({ playerId: 1, lineupSlotId: 20 }), null);

// --- parseEspnTeamRoster / parseEspnLeagueRosters ---
const irEntry = { playerId: 6000, lineupSlotId: 21, playerPoolEntry: { player: { id: 6000, firstName: 'Hurt', lastName: 'Guy', defaultPositionId: 4, proTeamId: 0, stats: [] } } };
const team = {
    id: 1,
    name: 'My Team',
    logo: 'https://example.com/logo.png',
    owners: ['{OWNER-GUID-1}', '{OWNER-GUID-2}'],
    playoffSeed: 2,
    divisionId: 0,
    record: { overall: { wins: 7, losses: 3, ties: 0, pointsFor: 1234.56, pointsAgainst: 1100.12 } },
    roster: { entries: [starterEntry, benchEntry, irEntry] },
};

const { roster, playersMeta } = parseEspnTeamRoster(team, { week: 3, resolvedSwid: '{OWNER-GUID-1}' });
check('roster_id comes from the team id', roster.roster_id, 1);
check('owner_id is the first owner guid', roster.owner_id, '{OWNER-GUID-1}');
check('co_owners is everyone else', roster.co_owners, ['{OWNER-GUID-2}']);
check('players lists every entry', roster.players.sort(), ['4000', '5000', '6000']);
check('starters only includes the non-bench, non-IR entry', roster.starters, ['4000']);
check('reserve only includes the IR entry', roster.reserve, ['6000']);
check('wins/losses come from record.overall', [roster.settings.wins, roster.settings.losses], [7, 3]);
check('fpts floors the decimal points-for', roster.settings.fpts, 1234);
check('a matching resolvedSwid marks this the current login\'s team', roster.is_owned_by_current_login, true);
check('every parsed entry lands in playersMeta', Object.keys(playersMeta).sort(), ['4000', '5000', '6000']);

const otherTeam = { id: 2, name: 'Other Team', owners: ['{OWNER-GUID-3}'], record: { overall: { wins: 3, losses: 7 } }, roster: { entries: [] } };
const leagueRosters = parseEspnLeagueRosters({ teams: [team, otherTeam] }, { week: 3, resolvedSwid: '{OWNER-GUID-1}' });
check('both teams are indexed by roster id', Object.keys(leagueRosters.rosters).sort(), ['1', '2']);
check('only the resolved-swid team is marked owned', leagueRosters.rosters[2].is_owned_by_current_login, false);
check('startersAndReserve carries both teams\' starters and reserve', leagueRosters.startersAndReserve.sort(), ['4000', '6000']);
check('the merged platform meta carries every parsed player', Object.keys(leagueRosters.yahooPlayersMeta).sort(), ['4000', '5000', '6000']);

// --- parseEspnSchedule ---
const schedule = [
    { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 100.5 }, away: { teamId: 2, totalPoints: 90.2 } },
    { matchupPeriodId: 1, home: { teamId: 3, totalPoints: 80 }, away: { teamId: 4, totalPoints: 70 } },
    { matchupPeriodId: 2, home: { teamId: 1, totalPoints: 0 }, away: { teamId: 3, totalPoints: 0 } },
    // A bye week: no away side at all.
    { matchupPeriodId: 3, home: { teamId: 5, totalPoints: 55 } },
    // Malformed rows are dropped rather than throwing.
    { matchupPeriodId: null, home: { teamId: 9 } },
    { matchupPeriodId: 4, home: null },
];
const byWeek = parseEspnSchedule(schedule);
check('week 1 has both matchups', byWeek[1].length, 2);
check('week 1\'s first matchup pairs the right teams', [byWeek[1][0][0].roster_id, byWeek[1][0][1].roster_id], [1, 2]);
check('week 1\'s points are carried over', [byWeek[1][0][0].points, byWeek[1][0][1].points], [100.5, 90.2]);
check('a bye week keeps only the home side', byWeek[3][0].length, 1);
check('malformed rows are dropped, not thrown', byWeek[4], undefined);
check('non-numeric matchupPeriodId rows are dropped', Object.keys(byWeek).includes('null'), false);

// --- parseEspnTransactions ---
const transactions = [
    {
        id: 't1', type: 'WAIVER', status: 'EXECUTED', processDate: 1700000000000,
        items: [{ playerId: 111, type: 'ADD', toTeamId: 1 }, { playerId: 222, type: 'DROP', fromTeamId: 1 }],
        bidAmount: 12,
    },
    {
        id: 't2', type: 'TRADE', status: 'EXECUTED', processDate: 1700100000000,
        items: [
            { playerId: 333, type: 'TRADE', toTeamId: 2, fromTeamId: 1 },
            { playerId: 444, type: 'TRADE', toTeamId: 1, fromTeamId: 2 },
        ],
    },
    // A declined trade offer never happened -- dropped.
    { id: 't3', type: 'TRADE', status: 'TRADE_DECLINED', items: [{ playerId: 555, type: 'TRADE', toTeamId: 2 }] },
    // A pure roster/IR move with no add or drop -- dropped.
    { id: 't4', type: 'ROSTER', status: 'EXECUTED', items: [{ playerId: 666, type: 'LINEUP' }] },
];
const parsedTxns = parseEspnTransactions(transactions);
check('declined and no-op transactions are dropped', parsedTxns.length, 2);
check('newest transaction sorts first', parsedTxns[0].transaction_id, 't2');
check('a waiver claim resolves adds and drops', [parsedTxns[1].adds, parsedTxns[1].drops], [{ '111': 1 }, { '222': 1 }]);
check('a waiver claim keeps its bid amount', parsedTxns[1].settings, { waiver_bid: 12 });
check('a trade type is reported as trade', parsedTxns[0].type, 'trade');
check('a trade resolves the receiving side as an add', parsedTxns[0].adds, { '333': 2, '444': 1 });
check('a trade\'s roster_ids include every team involved', parsedTxns[0].roster_ids.sort(), [1, 2]);

// --- parseEspnDraftDetail ---
const draftPicks = [];
for (let round = 1; round <= 2; round++) {
    for (let slot = 1; slot <= 4; slot++) {
        const positionInRound = round % 2 === 0 ? 5 - slot : slot; // snaking
        draftPicks.push({
            playerId: round * 1000 + slot,
            teamId: slot,
            roundId: round,
            overallPickNumber: (round - 1) * 4 + positionInRound,
        });
    }
}
const board = parseEspnDraftDetail({ picks: draftPicks }, { season: 2025, isAuction: false });
check('board reports the season', board.season, '2025');
check('board detects a snake order', board.type, 'snake');
check('slot_to_roster_id is built from round one', board.slot_to_roster_id, { 1: 1, 2: 2, 3: 3, 4: 4 });
check('picks are sorted by overall pick number', board.picks.map(p => p.player_id), draftPicks.slice().sort((a, b) => a.overallPickNumber - b.overallPickNumber).map(p => String(p.playerId)));
// Round two snakes back: team4 (draft_slot 4) picks first in round two, same
// slot it held all along -- the slot names the team, not the pick order.
check('round two\'s opening pick belongs to the slot that picked last in round one', board.picks[4].roster_id, 4);
check('that pick\'s draft_slot matches its team\'s slot from round one', board.picks[4].draft_slot, 4);
check('round two\'s closing pick belongs to the slot that picked first in round one', board.picks[7].roster_id, 1);
check('settings reports team and round counts', board.settings, { teams: 4, rounds: 2 });
check('no picks at all -> null, not an empty board', parseEspnDraftDetail({ picks: [] }), null);
check('missing draftDetail -> null', parseEspnDraftDetail(null), null);

console.log(`OK: ${checks} ESPN parser checks passed`);
