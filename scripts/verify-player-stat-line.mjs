import assert from 'node:assert/strict';
import { resolveSleeperStatsId, buildProjectedStatLine, buildLiveStatLine } from '../src/utils/playerStatLine.js';

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

// --- resolveSleeperStatsId ---
check(
    'a Sleeper-native entry (sleeper_id === its own id) resolves to that id',
    resolveSleeperStatsId({ sleeper_id: '4046', player_id: '4046', id: '4046' }),
    '4046'
);
check(
    'a Yahoo-crosswalk-matched entry prefers sleeper_id over the Yahoo-keyed id',
    resolveSleeperStatsId({ sleeper_id: '4046', id: '31883' }),
    '4046'
);
check(
    'an entry with only a bare Yahoo id and no sleeper_id has no resolvable identity',
    resolveSleeperStatsId({ id: '31883', fn: 'Some', ln: 'Player' }),
    null
);
check(
    'an entry with sleeper_id explicitly null (a tried-and-failed crosswalk match) has no identity',
    resolveSleeperStatsId({ sleeper_id: null, id: '31883' }),
    null
);
check('no player at all resolves to null', resolveSleeperStatsId(null), null);
check('an empty object resolves to null', resolveSleeperStatsId({}), null);

// --- buildProjectedStatLine ---
const qbGroups = [
    { name: 'PASS', cols: [{ label: 'YD', key: 'pass_yd' }, { label: 'TD', key: 'pass_td' }] },
    { name: 'RUSH', cols: [{ label: 'YD', key: 'rush_yd' }, { label: 'TD', key: 'rush_td' }] },
];

check(
    'every present numeric category is included',
    buildProjectedStatLine(qbGroups, { pass_yd: 245, pass_td: 2, rush_yd: 12, rush_td: 0 }),
    [
        { key: 'PASS-YD', label: 'PASS YD', val: 245 },
        { key: 'PASS-TD', label: 'PASS TD', val: 2 },
        { key: 'RUSH-YD', label: 'RUSH YD', val: 12 },
        { key: 'RUSH-TD', label: 'RUSH TD', val: 0 },
    ]
);

check(
    'a category the projection genuinely lacks is left out, not fabricated as 0',
    buildProjectedStatLine(qbGroups, { pass_yd: 245 }),
    [{ key: 'PASS-YD', label: 'PASS YD', val: 245 }]
);

check(
    'a completely empty projection produces an empty stat line',
    buildProjectedStatLine(qbGroups, {}),
    []
);

check(
    'null projection stats produce an empty stat line, not a crash',
    buildProjectedStatLine(qbGroups, null),
    []
);

check(
    'a non-numeric value (e.g. a string placeholder) is excluded',
    buildProjectedStatLine(qbGroups, { pass_yd: '245', pass_td: 2 }),
    [{ key: 'PASS-TD', label: 'PASS TD', val: 2 }]
);

// --- buildLiveStatLine (Matchups.jsx/Rosters.jsx's real-time stat tile line) ---

// Nothing real yet -> null, never a fabricated placeholder.
check('no stats object at all -> null', buildLiveStatLine('QB', null), null);
check('an empty stats object -> null', buildLiveStatLine('QB', {}), null);
check('a position with no matching stats -> null', buildLiveStatLine('QB', { rec: 3, rec_yd: 40 }), null);

check(
    'QB passing line',
    buildLiveStatLine('QB', { pass_att: 25, pass_cmp: 18, pass_yd: 245, pass_td: 2, pass_int: 1 }),
    '18/25, 245 YD, 2 TD, 1 INT'
);
check(
    'QB with a rushing add-on',
    buildLiveStatLine('QB', { pass_att: 10, pass_cmp: 7, pass_yd: 80, rush_att: 4, rush_yd: 22, rush_td: 1 }),
    '7/10, 80 YD, 22 RUSH YD, 1 RUSH TD'
);
check('QB with zero completions/attempts omits the passing line entirely', buildLiveStatLine('QB', { pass_att: 0, pass_cmp: 0 }), null);

check(
    'a rusher with no receptions only shows the rushing group',
    buildLiveStatLine('RB', { rush_att: 12, rush_yd: 68, rush_td: 1, rec: 0 }),
    '12 CAR, 68 YD, 1 TD'
);
check(
    'a receiver with both rushing and receiving shows both groups',
    buildLiveStatLine('WR', { rush_att: 2, rush_yd: 15, rec: 5, rec_yd: 62, rec_td: 1 }),
    '2 CAR, 15 YD, 5 REC, 62 YD, 1 TD'
);
check('a receiver with zero catches so far -> null', buildLiveStatLine('WR', { rec: 0, rec_yd: 0 }), null);

check('kicker line', buildLiveStatLine('K', { fgm: 2, fga: 3, xpm: 4, xpa: 4 }), '2/3 FG, 4/4 XP');
check('a kicker with no attempts yet -> null', buildLiveStatLine('K', {}), null);

check(
    'defense line',
    buildLiveStatLine('DEF', { sack: 3, int: 1, fum_rec: 1, ff: 2, def_td: 1, pts_allow: 14 }),
    '3 SACK, 1 INT, 1 FR, 2 FF, 1 TD, 14 PA'
);
check('a real zero points-allowed is kept (0 PA is a real, good stat, not "no data")', buildLiveStatLine('DEF', { pts_allow: 0 }), '0 PA');

check('unwraps a { stats: {...} } wrapper shape, same as Sleeper\'s own feed', buildLiveStatLine('K', { stats: { fgm: 1, fga: 1 } }), '1/1 FG');

console.log(`OK: ${checks} player stat-line checks passed`);
