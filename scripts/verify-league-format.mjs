import assert from 'node:assert/strict';
import {
    sleeperLeagueFormat,
    estimateFormatFromCarryover,
    estimateLeagueFormatFromRosterSets,
    formatLabel,
    KEEPER_MAX_CARRYOVER,
} from '../src/utils/leagueFormat.js';

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

// --- sleeperLeagueFormat: Sleeper's own field is authoritative ---
check('type 2 is dynasty', sleeperLeagueFormat(2), 'dynasty');
check('type 1 is keeper', sleeperLeagueFormat(1), 'keeper');
check('type 0 is redraft', sleeperLeagueFormat(0), 'redraft');
check('missing type defaults to redraft, not dynasty', sleeperLeagueFormat(undefined), 'redraft');
check('a string "2" still reads as dynasty', sleeperLeagueFormat('2'), 'dynasty');

// --- estimateFormatFromCarryover: one roster's year-over-year overlap ---
check(
    'no prior season -> unknown, not guessed',
    estimateFormatFromCarryover(['1', '2'], null).format,
    null
);
check(
    'empty prior roster -> unknown',
    estimateFormatFromCarryover(['1', '2'], []).format,
    null
);
check(
    'zero overlap -> redraft',
    estimateFormatFromCarryover(['1', '2', '3'], ['9', '8', '7']).format,
    'redraft'
);
check(
    'a couple of held players -> keeper',
    estimateFormatFromCarryover(['1', '2', '3', '4'], ['1', '2', '9', '8']).format,
    'keeper'
);
check(
    'exactly at the keeper cap is still keeper',
    estimateFormatFromCarryover(
        Array.from({ length: KEEPER_MAX_CARRYOVER }, (_, i) => String(i)),
        Array.from({ length: KEEPER_MAX_CARRYOVER }, (_, i) => String(i))
    ).format,
    'keeper'
);
check(
    'one more than the keeper cap tips into dynasty',
    estimateFormatFromCarryover(
        Array.from({ length: KEEPER_MAX_CARRYOVER + 1 }, (_, i) => String(i)),
        Array.from({ length: KEEPER_MAX_CARRYOVER + 1 }, (_, i) => String(i))
    ).format,
    'dynasty'
);
check(
    'most of the roster held over -> dynasty',
    estimateFormatFromCarryover(['1', '2', '3', '4', '5', '6', '7', '8'], ['1', '2', '3', '4', '5', '6', '7', '9']).format,
    'dynasty'
);
check(
    'ids compare as strings so numeric vs string ids still match',
    estimateFormatFromCarryover([1, 2, 3], ['1', '2', '9']).carried,
    2
);

// --- estimateLeagueFormatFromRosterSets: the whole league, matched by manager ---
const currentRosters = [
    { owner_id: 'mgrA', players: ['1', '2', '3'] },       // 0 held -> redraft-like
    { owner_id: 'mgrB', players: ['4', '5', '9', '10'] },  // 2 held -> keeper-like
    { owner_id: 'mgrC', players: ['6', '7', '11'] },       // 2 held -> keeper-like
];
const priorRosters = [
    { owner_id: 'mgrA', players: ['20', '21', '22'] },
    { owner_id: 'mgrB', players: ['4', '5', '30', '31'] },
    { owner_id: 'mgrC', players: ['6', '7', '32'] },
];

check(
    'the league-wide answer is the median team, not any one team',
    estimateLeagueFormatFromRosterSets(currentRosters, priorRosters).format,
    'keeper'
);

check(
    'no prior season for the league at all -> unknown',
    estimateLeagueFormatFromRosterSets(currentRosters, []).format,
    null
);

check(
    'a co-owner still matches across seasons',
    estimateLeagueFormatFromRosterSets(
        [{ owner_id: 'x', co_owners: ['mgrB'], players: ['4', '5', '9'] }],
        priorRosters
    ).format,
    'keeper'
);

check(
    'a team with nobody matched in the prior season is excluded, not counted as zero',
    estimateLeagueFormatFromRosterSets(
        [{ owner_id: 'brandNewOwner', players: ['1', '2', '3'] }, ...currentRosters],
        priorRosters
    ).sampleSize,
    3
);

check(
    'every team churning fully -> redraft',
    estimateLeagueFormatFromRosterSets(
        [{ owner_id: 'mgrA', players: ['1', '2'] }],
        [{ owner_id: 'mgrA', players: ['9', '10'] }]
    ).format,
    'redraft'
);

check(
    'a whole dynasty league reads as dynasty',
    estimateLeagueFormatFromRosterSets(
        [
            { owner_id: 'a', players: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
            { owner_id: 'b', players: ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20'] },
        ],
        [
            { owner_id: 'a', players: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '99'] },
            { owner_id: 'b', players: ['11', '12', '13', '14', '15', '16', '17', '18', '19', '98'] },
        ]
    ).format,
    'dynasty'
);

// --- formatLabel ---
check('dynasty label', formatLabel('dynasty'), 'Dynasty');
check('keeper label', formatLabel('keeper'), 'Keeper');
check('redraft label', formatLabel('redraft'), 'Redraft');
check('an unknown format defaults to the Redraft label, not Dynasty', formatLabel(null), 'Redraft');

console.log(`OK: ${checks} league-format checks passed`);
