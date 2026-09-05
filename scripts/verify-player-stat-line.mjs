import assert from 'node:assert/strict';
import { resolveSleeperStatsId, buildProjectedStatLine } from '../src/utils/playerStatLine.js';

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

console.log(`OK: ${checks} player stat-line checks passed`);
