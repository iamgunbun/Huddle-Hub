import assert from 'node:assert/strict';
import { ordinal, describeExperienceAtDraft } from '../src/utils/draftContext.js';

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

// --- ordinal ---
check('1 -> 1st', ordinal(1), '1st');
check('2 -> 2nd', ordinal(2), '2nd');
check('3 -> 3rd', ordinal(3), '3rd');
check('4 -> 4th', ordinal(4), '4th');
check('11 -> 11th (not 11st)', ordinal(11), '11th');
check('12 -> 12th', ordinal(12), '12th');
check('13 -> 13th', ordinal(13), '13th');
check('21 -> 21st', ordinal(21), '21st');
check('22 -> 22nd', ordinal(22), '22nd');
check('101 -> 101st', ordinal(101), '101st');
check('111 -> 111th', ordinal(111), '111th');

// --- describeExperienceAtDraft ---
check(
    'a current rookie (0 years exp), reviewed the same season, is a rookie at the pick',
    describeExperienceAtDraft(0, 0),
    'a rookie at the time of this pick'
);
check(
    'Loveland: drafted as a rookie, reviewed a year later -- still a rookie AT THE PICK, not a sophomore',
    describeExperienceAtDraft(1, 1),
    'a rookie at the time of this pick'
);
check(
    'a player with 3 years exp now, drafted 3 seasons ago, was a rookie at the pick',
    describeExperienceAtDraft(3, 3),
    'a rookie at the time of this pick'
);
check(
    'the same player\'s stats reviewed only 2 seasons after the pick: their 2nd season, not a rookie',
    describeExperienceAtDraft(3, 2),
    'entering their 2nd NFL season at the time of this pick'
);
check(
    'a veteran picked up this season (exp already established) is not a rookie',
    describeExperienceAtDraft(5, 0),
    'entering their 6th NFL season at the time of this pick'
);
check(
    'JSN-like case: 3rd-year now, reviewed same season -- an established player, not a late-round unknown',
    describeExperienceAtDraft(2, 0),
    'entering their 3rd NFL season at the time of this pick'
);
check(
    'no experience figure available -> no guess',
    describeExperienceAtDraft(null, 1),
    null
);
check(
    'a non-numeric experience figure -> no guess',
    describeExperienceAtDraft(undefined, 1),
    null
);
check(
    'a negative "years since" (bad input) is treated as zero elapsed, not negative experience',
    describeExperienceAtDraft(2, -3),
    'entering their 3rd NFL season at the time of this pick'
);

console.log(`OK: ${checks} draft-context checks passed`);
