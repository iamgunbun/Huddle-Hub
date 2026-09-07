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
    findPriorEspnSeason,
    isEspnSeasonComplete,
    buildEspnScoringSettings,
    espnLineupSlotName,
    buildEspnRosterPositions,
    espnTeamLogoUrl,
    parseEspnAthleteResponse,
    isEspnLeagueManager,
    memberHasManagerFlag,
    espnLeagueManagerIds,
    describeEspnMemberFlags,
    normalizeSwid,
    espnSwidMatches,
    toProxiedEspnImageUrl,
    isEspnCdnUrl,
    espnDefenseProTeamId,
    espnDefenseMetaFromId,
} from '../src/utils/espnParsers.js';
import { scoreStatLine } from '../src/utils/yahooScoring.js';

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
// A player's defaultPositionId is NOT the lineup-slot enum. Confirmed against
// a live league: with the slot numbering applied here, real tight ends came
// back labelled "WR" (slot id 4) and real receivers and kickers came back
// "BN" (slot numbering has no 3 or 5).
check('defaultPositionId 1 is QB', espnPositionName(1), 'QB');
check('defaultPositionId 2 is RB', espnPositionName(2), 'RB');
check('defaultPositionId 3 is WR', espnPositionName(3), 'WR');
check('defaultPositionId 4 is TE', espnPositionName(4), 'TE');
check('defaultPositionId 5 is K', espnPositionName(5), 'K');
check('defaultPositionId 16 is DEF', espnPositionName(16), 'DEF');
check('unknown position falls back to BN', espnPositionName(999), 'BN');
// The slot enum's own ids must NOT resolve as positions here -- that
// conflation is exactly what mislabeled tight ends as receivers.
check('slot-numbering QB (0) is not a position id', espnPositionName(0), 'BN');
check('slot-numbering TE (6) is not a position id', espnPositionName(6), 'BN');
check('slot-numbering K (17) is not a position id', espnPositionName(17), 'BN');
check('bench slot (20) is not a starter', isEspnStarterSlot(20), false);
check('IR slot (21) is not a starter', isEspnStarterSlot(21), false);
check('IR slot is reserve', isEspnReserveSlot(21), true);
check('a flex slot (23) is a starter', isEspnStarterSlot(23), true);
check('headshot url is built from the id', espnHeadshotUrl('12345'), 'https://a.espncdn.com/i/headshots/nfl/players/full/12345.png');
check('no id -> no headshot url', espnHeadshotUrl(null), null);
check('team name prefers the explicit name field', espnTeamDisplayName({ id: 1, name: 'The Bengals of Fortune' }), 'The Bengals of Fortune');
check('team name falls back to location + nickname', espnTeamDisplayName({ id: 2, location: 'Team', nickname: 'Two' }), 'Team Two');
check('team name falls back to a generic label', espnTeamDisplayName({ id: 3 }), 'Team 3');

// --- espnTeamLogoUrl ---
check('a normal absolute https url passes through', espnTeamLogoUrl('https://g.espncdn.com/logo.png'), 'https://g.espncdn.com/logo.png');
check('a protocol-relative url gets https: prepended', espnTeamLogoUrl('//g.espncdn.com/logo.png'), 'https://g.espncdn.com/logo.png');
check('an empty string -> null, not a broken image', espnTeamLogoUrl(''), null);
check('null -> null', espnTeamLogoUrl(null), null);
check('a bare filename with no scheme -> null', espnTeamLogoUrl('logo_default_1.svg'), null);
check('a plain http url gets upgraded to https', espnTeamLogoUrl('http://a.espncdn.com/logo.png'), 'https://a.espncdn.com/logo.png');

// --- toProxiedEspnImageUrl ---
check(
    'an https url is routed through the image proxy with both params',
    toProxiedEspnImageUrl('https://a.espncdn.com/logo.png', 'user-1'),
    '/api/espn-image-proxy?url=https%3A%2F%2Fa.espncdn.com%2Flogo.png&userId=user-1'
);
check('no userId -> the url is left alone (nothing to attach cookies for)',
    toProxiedEspnImageUrl('https://a.espncdn.com/logo.png', null), 'https://a.espncdn.com/logo.png');
check('a local fallback path is never proxied', toProxiedEspnImageUrl('/brand.png', 'user-1'), '/brand.png');
check('null url stays null', toProxiedEspnImageUrl(null, 'user-1'), null);
// A manager can point their ESPN team logo at any image on the internet.
// Those need no ESPN session and the proxy would reject the host outright,
// so proxying them would break a logo that loads fine on its own.
check('a non-ESPN host is left as a direct link, not proxied',
    toProxiedEspnImageUrl('https://i.imgur.com/abc.png', 'user-1'), 'https://i.imgur.com/abc.png');
check('espncdn.com itself is proxied', isEspnCdnUrl('https://espncdn.com/x.png'), true);
check('an espncdn subdomain is proxied', isEspnCdnUrl('https://g.espncdn.com/x.png'), true);
// A CUSTOM_UPLOAD team logo (a manager's own uploaded image, as opposed to a
// stock VECTOR mascot/helmet) lives on a completely different ESPN host --
// confirmed live against a real league's raw mTeam response. Missing this
// was the actual bug: those logos were hotlinked directly, unproxied, and
// silently failed while every stock logo on espncdn.com kept working.
check('a fantasy.espn.com custom-upload logo is proxied', isEspnCdnUrl('https://fantasy.espn.com/x.png'), true);
check('the real mystique-api custom-upload host is proxied',
    isEspnCdnUrl('https://mystique-api.fantasy.espn.com/apis/v1/domains/lm/images/abc-123'), true);
check('an unrelated host is not', isEspnCdnUrl('https://i.imgur.com/x.png'), false);
check('a lookalike host is not (suffix match must be on a dot boundary)',
    isEspnCdnUrl('https://notespncdn.com/x.png'), false);
check('a fantasy.espn.com lookalike host is not (suffix match must be on a dot boundary)',
    isEspnCdnUrl('https://notfantasy.espn.com/x.png'), false);
check('garbage is not a CDN url', isEspnCdnUrl('not a url'), false);

// --- team defenses: ESPN's negative pseudo-player ids ---
check('a D/ST id decodes to its pro team', espnDefenseProTeamId(-16013), 13);
check('the Titans D/ST decodes to team 10', espnDefenseProTeamId(-16010), 10);
check('a positive (real athlete) id is not a defense', espnDefenseProTeamId(4362628), null);
check('a negative id outside the real team range decodes to no team', espnDefenseProTeamId(-16099), null);
check('junk decodes to no team', espnDefenseProTeamId(null), null);

const dstMeta = espnDefenseMetaFromId(-16013);
check('a dropped defense resolves a DEF position instead of a bare id', dstMeta.pos, 'DEF');
check('and the team abbreviation Sleeper keys its own defenses by', dstMeta.t, 'LV');
check('and reads as a D/ST rather than a player name', dstMeta.ln, 'D/ST');
check('and carries no athlete headshot', dstMeta.headshot, null);
check('a real athlete id produces no defense metadata', espnDefenseMetaFromId(4362628), null);
// An unrecognized negative id is still definitely a defense -- better to say
// so with no team than to confidently name the wrong one.
const unknownDst = espnDefenseMetaFromId(-16099);
check('an undecodable defense id is still marked DEF', unknownDst.pos, 'DEF');
check('but claims no team', unknownDst.t, 'FA');

// --- espnLineupSlotName / buildEspnRosterPositions ---
check('slot 0 is QB', espnLineupSlotName(0), 'QB');
check('slot 23 is FLEX', espnLineupSlotName(23), 'FLEX');
check('slot 7 is a superflex', espnLineupSlotName(7), 'SUPER_FLEX');
check('slot 20 is bench', espnLineupSlotName(20), 'BN');
check('an unknown slot falls back to bench', espnLineupSlotName(999), 'BN');

const rosterPositions = buildEspnRosterPositions({
    '0': 1,  // QB
    '2': 2,  // RB x2
    '4': 2,  // WR x2
    '6': 1,  // TE
    '23': 1, // FLEX
    '17': 1, // K
    '16': 1, // DEF
    '20': 6, // BN x6
    '21': 1, // IR -- excluded from roster_positions entirely
});
check(
    'starters are grouped in the shared slot order, bench appended after',
    rosterPositions,
    ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN']
);
check('IR is never counted in roster_positions', rosterPositions.includes('IR'), false);
check('no lineup slot counts at all -> an empty array, not a throw', buildEspnRosterPositions(null), []);
check('a zero count contributes nothing', buildEspnRosterPositions({ '0': 1, '2': 0 }), ['QB']);

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
            defaultPositionId: 2, // RB in the player-position enum
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

// A defense pseudo-player: the DEF lineup slot (16) is trusted over
// defaultPositionId, in case that field ever comes back unset or wrong for
// a non-athlete roster entry like a team defense.
const defEntry = {
    playerId: 25,
    lineupSlotId: 16,
    playerPoolEntry: { player: { id: 25, firstName: '', lastName: '49ers D/ST', defaultPositionId: 16, proTeamId: 25, stats: [] } },
};
const parsedDef = parseEspnRosterEntry(defEntry);
check('a DEF slot entry resolves pos to DEF', parsedDef.pos, 'DEF');
check('a defense has no athlete headshot url', parsedDef.headshot, null);

const defWithBadPositionId = {
    playerId: 26,
    lineupSlotId: 16,
    playerPoolEntry: { player: { id: 26, firstName: '', lastName: 'Some Defense', defaultPositionId: 999, proTeamId: 1, stats: [] } },
};
check(
    'the DEF slot resolves pos to DEF even when defaultPositionId is missing/wrong',
    parseEspnRosterEntry(defWithBadPositionId).pos,
    'DEF'
);

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

// A team whose entries arrive in a different order than the canonical slot
// order (K before QB, DEF before RB) -- the exact bug that showed every ESPN
// starter labeled "BN": the Rosters page pairs starters[i] with
// roster_positions[i] by index, so starters has to come out pre-sorted into
// that same order regardless of what order ESPN happened to list them in.
const mkEntry = (playerId, lineupSlotId, defaultPositionId) => ({
    playerId, lineupSlotId,
    playerPoolEntry: { player: { id: playerId, firstName: 'P', lastName: String(playerId), defaultPositionId, proTeamId: 0, stats: [] } },
});
const shuffledTeam = {
    id: 9,
    name: 'Shuffled',
    owners: [],
    record: { overall: {} },
    roster: {
        entries: [
            mkEntry(9001, 17, 17), // K
            mkEntry(9002, 0, 0),  // QB
            mkEntry(9003, 16, 16), // DEF
            mkEntry(9004, 2, 2),  // RB
            mkEntry(9005, 23, 2), // FLEX
        ],
    },
};
const { roster: shuffledRoster } = parseEspnTeamRoster(shuffledTeam);
check(
    'starters come out in canonical slot order regardless of entry order',
    shuffledRoster.starters,
    ['9002', '9004', '9005', '9003', '9001']
);

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

// A draft pick is an acquisition, but it is not one of "your moves". Folding
// DRAFT rows in with free agency is what made two waiver claims count as five.
const draftAndPending = parseEspnTransactions([
    { id: 'd1', type: 'DRAFT', status: 'EXECUTED', items: [{ playerId: 777, type: 'ADD', toTeamId: 1 }] },
    { id: 'w1', type: 'WAIVER', status: 'EXECUTED', items: [{ playerId: 888, type: 'ADD', toTeamId: 1 }] },
    { id: 'f1', type: 'FREEAGENT', status: 'EXECUTED', items: [{ playerId: 999, type: 'ADD', toTeamId: 1 }] },
    // Neither of these actually happened.
    { id: 'p1', type: 'WAIVER', status: 'PENDING', items: [{ playerId: 1010, type: 'ADD', toTeamId: 1 }] },
    { id: 'c1', type: 'WAIVER', status: 'CANCELED', items: [{ playerId: 1111, type: 'ADD', toTeamId: 1 }] },
]);
check('pending and cancelled claims never happened, so they are dropped', draftAndPending.length, 3);
check('a draft pick keeps its own type rather than posing as a free agent add',
    draftAndPending.find(t => t.transaction_id === 'd1').type, 'draft');
check('a waiver claim is still a waiver', draftAndPending.find(t => t.transaction_id === 'w1').type, 'waiver');
check('a free agent add is still a free agent add',
    draftAndPending.find(t => t.transaction_id === 'f1').type, 'free_agent');

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

// --- findPriorEspnSeason (the previous_league_id stand-in for ESPN) ---
check('the newest year before this season wins', findPriorEspnSeason([2022, 2023, 2024], 2025), 2024);
check('years are not assumed sorted', findPriorEspnSeason([2021, 2024, 2022], 2025), 2024);
check('no list at all -> no prior season', findPriorEspnSeason(null, 2025), null);
check('an empty list -> no prior season', findPriorEspnSeason([], 2025), null);
check('every entry is this season or later -> no prior season', findPriorEspnSeason([2025, 2026], 2025), null);
check('a malformed seasonId -> null rather than a wrong walk', findPriorEspnSeason([2024], 'not-a-year'), null);
check('non-numeric entries in the list are ignored', findPriorEspnSeason(['bad', 2023], 2025), 2023);

// --- isEspnSeasonComplete ---
check(
    'a season before the real current year is always complete',
    isEspnSeasonComplete({ seasonId: 2023, currentMatchupPeriod: 1, matchupPeriodCount: 17, currentYear: 2026 }),
    true
);
check(
    'the live season is not complete until its scoring periods run out',
    isEspnSeasonComplete({ seasonId: 2026, currentMatchupPeriod: 10, matchupPeriodCount: 17, currentYear: 2026 }),
    false
);
check(
    'the live season completes once currentMatchupPeriod passes the total',
    isEspnSeasonComplete({ seasonId: 2026, currentMatchupPeriod: 18, matchupPeriodCount: 17, currentYear: 2026 }),
    true
);
check(
    'no matchupPeriodCount at all -> assume still in progress rather than complete',
    isEspnSeasonComplete({ seasonId: 2026, currentMatchupPeriod: 5, matchupPeriodCount: 0, currentYear: 2026 }),
    false
);

// --- buildEspnScoringSettings ---
const espnScoring = buildEspnScoringSettings({
    scoringItems: [
        { statId: 3, points: 0.04 },   // pass_yd
        { statId: 4, points: 4 },      // pass_td
        { statId: 20, points: 2, isReverseItem: true },   // pass_int, penalty
        { statId: 24, points: 0.1 },   // rush_yd
        { statId: 25, points: 6 },     // rush_td
        { statId: 42, points: 0.1 },   // rec_yd
        { statId: 43, points: 6 },     // rec_td
        { statId: 53, points: 1 },     // rec (full PPR)
        { statId: 72, points: -2 },    // fum_lost, already negative
        { statId: 999, points: 5 },    // unknown id -- ignored
    ],
});
check('passing yards rate carries over as-is', espnScoring.pass_yd, 0.04);
check('passing touchdown value carries over', espnScoring.pass_td, 4);
check('a reverse item is always a penalty, even stored positive', espnScoring.pass_int, -2);
check('an already-negative reverse item is not double-negated', espnScoring.fum_lost, -2);
check('reception value reflects full PPR', espnScoring.rec, 1);
check('rushing/receiving touchdown values carry over', [espnScoring.rush_td, espnScoring.rec_td], [6, 6]);
check('an unmapped statId is silently ignored', Object.prototype.hasOwnProperty.call(espnScoring, '999'), false);
check('no scoring settings at all -> an empty object, not a throw', buildEspnScoringSettings(null), {});
check('no scoringItems array -> an empty object', buildEspnScoringSettings({}), {});

// --- buildEspnScoringSettings: defense and kicker (verified statIds) ---
const kdScoring = buildEspnScoringSettings({
    scoringItems: [
        { statId: 99, points: 1 },      // sack
        { statId: 95, points: 2 },      // int
        { statId: 96, points: 2 },      // fum_rec
        { statId: 94, points: 6 },      // def_td
        { statId: 98, points: 2 },      // safe
        { statId: 97, points: 2 },      // blk_kick
        { statId: 86, points: 1 },      // xpm
        { statId: 88, points: -1 },     // xpmiss, already negative
        { statId: 80, points: 3 },      // FG made under 40
        { statId: 77, points: 4 },      // FG made 40-49
        { statId: 74, points: 5 },      // FG made 50+
        { statId: 82, points: -1 },     // FG missed under 40
        { statId: 89, points: 10 },     // pts allowed 0
        { statId: 90, points: 7 },      // pts allowed 1-6
        { statId: 91, points: 4 },      // pts allowed 7-13
        { statId: 92, points: 1 },      // pts allowed 14-17
        { statId: 121, points: 0 },     // pts allowed 18-21
        { statId: 122, points: -1 },    // pts allowed 22-27
        { statId: 123, points: -3 },    // pts allowed 28-34
        { statId: 124, points: -5 },    // pts allowed 35-45
        { statId: 125, points: -7 },    // pts allowed 45+
    ],
});
check('the six direct-mapped defensive categories all carry over', {
    sack: kdScoring.sack, int: kdScoring.int, fum_rec: kdScoring.fum_rec,
    def_td: kdScoring.def_td, safe: kdScoring.safe, blk_kick: kdScoring.blk_kick,
}, { sack: 1, int: 2, fum_rec: 2, def_td: 6, safe: 2, blk_kick: 2 });
check('extra point made/missed carry over', [kdScoring.xpm, kdScoring.xpmiss], [1, -1]);
check(
    'ESPN\'s single under-40 FG band fills all three of Sleeper\'s narrower buckets',
    [kdScoring.fgm_0_19, kdScoring.fgm_20_29, kdScoring.fgm_30_39],
    [3, 3, 3]
);
check('the 40-49 and 50+ FG bands map directly', [kdScoring.fgm_40_49, kdScoring.fgm_50p], [4, 5]);
check('a missed FG band not provided for 40-49/50+ is simply absent, not zero', kdScoring.fgmiss_40_49, undefined);
check(
    'points-allowed tiers that line up exactly map directly',
    [kdScoring.pts_allow_0, kdScoring.pts_allow_1_6, kdScoring.pts_allow_7_13, kdScoring.pts_allow_28_34],
    [10, 7, 4, -3]
);
check('Sleeper\'s 14-20 bucket takes ESPN\'s larger-overlap 14-17 tier', kdScoring.pts_allow_14_20, 1);
check('Sleeper\'s 21-27 bucket takes ESPN\'s larger-overlap 22-27 tier', kdScoring.pts_allow_21_27, -1);
check('Sleeper\'s single 35+ bucket averages ESPN\'s 35-45 and 45+ tiers', kdScoring.pts_allow_35p, -6);

const onlyOneHighTier = buildEspnScoringSettings({ scoringItems: [{ statId: 125, points: -8 }] });
check('35+ falls back to whichever single high tier is present', onlyOneHighTier.pts_allow_35p, -8);

// A scored projection under real ESPN-derived settings is the actual bug this
// fixes: ESPN projections were silently using generic Sleeper standard/PPR
// scoring regardless of the league's real rules, because scoring_settings was
// never populated for an ESPN league at all.
const statLine = { pass_yd: 300, pass_td: 3, rush_yd: 20 };
const scored = scoreStatLine(statLine, espnScoring, 'QB');
// 300*0.04 + 3*4 + 20*0.1 = 12 + 12 + 2 = 26
check('a QB stat line scores correctly under the league\'s real ESPN settings', scored, 26);

// --- parseEspnAthleteResponse ---
const athlete = parseEspnAthleteResponse({
    athlete: {
        id: 4362628,
        displayName: 'Dropped Guy',
        position: { abbreviation: 'WR' },
        team: { abbreviation: 'sf' },
        headshot: { href: 'https://a.espncdn.com/i/headshots/nfl/players/full/4362628.png' },
    },
});
check('athlete lookup resolves an id, coerced to a string', athlete.id, '4362628');
check('athlete lookup splits a display name', [athlete.fn, athlete.ln], ['Dropped', 'Guy']);
check('athlete lookup resolves position', athlete.pos, 'WR');
check('athlete lookup upper-cases the team abbreviation', athlete.t, 'SF');
check('athlete lookup prefers the response\'s own headshot url', athlete.headshot, 'https://a.espncdn.com/i/headshots/nfl/players/full/4362628.png');

const athleteNoHeadshot = parseEspnAthleteResponse({ athlete: { id: 1, displayName: 'No Photo Guy' } });
check('missing headshot falls back to the standard CDN pattern', athleteNoHeadshot.headshot, 'https://a.espncdn.com/i/headshots/nfl/players/full/1.png');
check('missing position/team fall back to BN/FA like everywhere else', [athleteNoHeadshot.pos, athleteNoHeadshot.t], ['BN', 'FA']);

check('no athlete in the response -> null', parseEspnAthleteResponse({}), null);
check('no response at all -> null', parseEspnAthleteResponse(null), null);
check('an athlete with no id at all -> null, not a garbage entry', parseEspnAthleteResponse({ athlete: { displayName: 'Ghost' } }), null);

// --- isEspnLeagueManager ---
const members = [
    { id: '{ABC-123}', isLeagueManager: false },
    { id: '{DEF-456}', isLeagueManager: true },
];
check('the member flagged isLeagueManager is the commissioner', isEspnLeagueManager(members, '{DEF-456}'), true);
check('matching is case-insensitive (SWIDs can come back either case)', isEspnLeagueManager(members, '{def-456}'), true);
check('a non-manager member is not the commissioner', isEspnLeagueManager(members, '{ABC-123}'), false);
check('a swid with no matching member is not the commissioner', isEspnLeagueManager(members, '{ZZZ-999}'), false);
check('no members array -> false, not a throw', isEspnLeagueManager(null, '{DEF-456}'), false);
check('no swid -> false', isEspnLeagueManager(members, null), false);
// The commissioner is a "League Manager" in ESPN's own UI; the account that
// created the league counts too.
check('a member flagged only isLeagueCreator also counts as commissioner',
    isEspnLeagueManager([{ id: '{AAA}', isLeagueCreator: true }], '{AAA}'), true);
// Two members, so the sole-member rule below doesn't apply: with a real
// league to share, an unflagged member is not the manager.
check('a member with neither flag does not',
    isEspnLeagueManager([{ id: '{AAA}' }, { id: '{BBB}' }], '{AAA}'), false);

// --- SWID normalisation ---
// ESPN brace-wraps the SWID it stores on members/owners, but a value copied
// out of a cookie inspector routinely arrives bare, URL-encoded, or padded.
// A literal comparison fails silently on all three.
check('braces are stripped', normalizeSwid('{ABC-123}'), 'ABC-123');
check('url-encoded braces are stripped', normalizeSwid('%7BABC-123%7D'), 'ABC-123');
check('whitespace and case are normalised', normalizeSwid('  {abc-123} '), 'ABC-123');
check('null normalises to an empty string', normalizeSwid(null), '');
check('a bare swid matches ESPN\'s brace-wrapped one', espnSwidMatches('ABC-123', '{ABC-123}'), true);
check('a url-encoded swid matches too', espnSwidMatches('%7Babc-123%7D', '{ABC-123}'), true);
check('two different swids still do not match', espnSwidMatches('{AAA}', '{BBB}'), false);
check('an empty swid never matches, not even another empty one', espnSwidMatches('', ''), false);
check('a brace-less stored swid finds its league manager',
    isEspnLeagueManager([{ id: '{DEF-456}', isLeagueManager: true }], 'DEF-456'), true);

// ESPN's real field name for "this member runs the league" isn't documented,
// and both of the obvious spellings turned out to be absent on a real league's
// member record. Any boolean whose KEY is about running/creating the league
// counts, so the check doesn't hinge on one guess.
check('an unexpected manager flag spelling still counts',
    isEspnLeagueManager([{ id: '{A}', leagueManager: true }, { id: '{B}' }], '{A}'), true);
check('a commissioner-shaped flag counts', memberHasManagerFlag({ isCommissioner: true }), true);
check('an admin-shaped flag counts', memberHasManagerFlag({ isLeagueAdmin: true }), true);
check('an unrelated true flag does not', memberHasManagerFlag({ isActive: true, hasPaid: true }), false);
check('a manager-ish key that is false does not count', memberHasManagerFlag({ isLeagueManager: false }), false);
check('a manager-ish key that is a non-boolean truthy value does not count',
    memberHasManagerFlag({ leagueManagerName: 'Somebody' }), false);
check('no member -> no flag', memberHasManagerFlag(null), false);

// Some responses name the managers in a list of their own rather than
// flagging each member.
check('a league-level manager list of bare swids is honoured',
    isEspnLeagueManager([{ id: '{A}' }, { id: '{B}' }], '{A}', { leagueManagers: ['{A}'] }), true);
check('a league-level manager list of objects is honoured',
    isEspnLeagueManager([{ id: '{A}' }, { id: '{B}' }], '{A}', { settings: { leagueManagers: [{ id: '{A}' }] } }), true);
check('a league-level list that does not name you grants nothing',
    isEspnLeagueManager([{ id: '{A}' }, { id: '{B}' }], '{A}', { leagueManagers: ['{B}'] }), false);
check('manager ids are read off whichever list is present',
    espnLeagueManagerIds({ settings: { managers: ['{A}', '{B}'] } }), ['{A}', '{B}']);
check('no list anywhere -> nothing', espnLeagueManagerIds({ settings: {} }), []);

// The diagnostic reports shape, never personal data.
const shape = describeEspnMemberFlags({ id: '{A}', displayName: 'Someone', isLeagueManager: false, isActive: true });
check('the diagnostic lists every field name', shape.keys, ['id', 'displayName', 'isLeagueManager', 'isActive']);
check('and reports only the boolean values', shape.booleans, { isLeagueManager: false, isActive: true });
check('no member -> nothing to describe', describeEspnMemberFlags(null), null);

// Sole member: a league with exactly one member in it is run by that member,
// whatever ESPN does or doesn't flag. ESPN returns every member (a 12-team
// league reports 12), so a list of one is a league of one, not a truncation.
check('the only member of a league is its manager',
    isEspnLeagueManager([{ id: '{ME}' }], '{ME}'), true);
check('but not when the sole member is someone else',
    isEspnLeagueManager([{ id: '{THEM}' }], '{ME}'), false);
check('and a full league still needs a real flag',
    isEspnLeagueManager([{ id: '{ME}' }, { id: '{THEM}' }], '{ME}'), false);
check('a flagged member in a full league is still found',
    isEspnLeagueManager([{ id: '{ME}', isLeagueManager: true }, { id: '{THEM}' }], '{ME}'), true);

console.log(`OK: ${checks} ESPN parser checks passed`);
