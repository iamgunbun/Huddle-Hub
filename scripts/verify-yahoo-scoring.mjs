// Dependency-free checks for the Yahoo -> Sleeper scoring translation.
// Run with: npm run verify:scoring
//
// These matter because the scoring math is the one place a silent mistake
// produces numbers that look plausible but are wrong.

import { buildYahooScoringSettings, scoreStatLine } from '../src/utils/yahooScoring.js';

let pass = 0;
let fail = 0;

const eq = (name, got, want) => {
    const ok = got === want || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9);
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | got=${got} want=${want}`);
    ok ? pass++ : fail++;
};

// A half-PPR league with 6-point passing TDs, plus defense categories.
// Uses Yahoo's numeric-keys-with-count collection shape.
const settings = {
    stat_categories: {
        stats: {
            count: 8,
            0: { stat: { stat_id: 4, name: 'Passing Yards', position_type: 'O' } },
            1: { stat: { stat_id: 5, name: 'Passing Touchdowns', position_type: 'O' } },
            2: { stat: { stat_id: 6, name: 'Interceptions', position_type: 'O' } },
            3: { stat: { stat_id: 9, name: 'Rushing Yards', position_type: 'O' } },
            4: { stat: { stat_id: 11, name: 'Receptions', position_type: 'O' } },
            5: { stat: { stat_id: 12, name: 'Reception Yards', position_type: 'O' } },
            6: { stat: { stat_id: 31, name: 'Interception', position_type: 'DT' } },
            7: { stat: { stat_id: 50, name: 'Points Allowed 7-13 points', position_type: 'DT' } },
        },
    },
    stat_modifiers: {
        stats: {
            count: 8,
            0: { stat: { stat_id: 4, value: 0.04 } },
            1: { stat: { stat_id: 5, value: 6 } },
            2: { stat: { stat_id: 6, value: -2 } },
            3: { stat: { stat_id: 9, value: 0.1 } },
            4: { stat: { stat_id: 11, value: 0.5 } },
            5: { stat: { stat_id: 12, value: 0.1 } },
            6: { stat: { stat_id: 31, value: 2 } },
            7: { stat: { stat_id: 50, value: 4 } },
        },
    },
};

const scoring = buildYahooScoringSettings(settings);

eq('passing yards value read from league', scoring.pass_yd, 0.04);
eq('6-point passing TD league respected', scoring.pass_td, 6);
eq("QB's thrown Interceptions -> pass_int", scoring.pass_int, -2);
eq("defense's Interception -> int", scoring.int, 2);
eq('half-PPR reception value', scoring.rec, 0.5);
eq('defense points-allowed tier captured', scoring.pts_allow_7_13, 4);

// The same payload as a plain array instead of numeric keys.
eq('array-shaped collections parse too', buildYahooScoringSettings({
    stat_categories: { stats: [{ stat: { stat_id: 4, name: 'Passing Yards', position_type: 'O' } }] },
    stat_modifiers: { stats: [{ stat: { stat_id: 4, value: 0.05 } }] },
}).pass_yd, 0.05);

// 300*0.04 + 2*6 + 1*-2 + 40*0.1 + 6*0.5 + 80*0.1 = 37
eq('offense scored exactly under league rules',
    scoreStatLine({ pass_yd: 300, pass_td: 2, pass_int: 1, rush_yd: 40, rec: 6, rec_yd: 80 }, scoring), 37);

// 2 INT (2*2) + points-allowed 10 lands in the 7-13 tier (4) = 8
eq('defense tier applied, not multiplied', scoreStatLine({ int: 2, pts_allow: 10 }, scoring), 8);
eq('points allowed outside configured tiers adds nothing', scoreStatLine({ int: 1, pts_allow: 25 }, scoring), 2);

// Kicker: league scores FGs by distance but a projection may only carry a total.
const kicker = { fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, xpm: 1 };
eq('kicker falls back to league FG values on a total-only projection',
    scoreStatLine({ fgm: 2, xpm: 3 }, kicker), 10.2); // avg(3,3,3,4,5)=3.6 -> 7.2 + 3
eq('kicker scored exactly when distance buckets are present',
    scoreStatLine({ fgm_40_49: 1, fgm_50p: 1, xpm: 1 }, kicker), 10);

// A stat line with none of the league's scored stats must report null so the
// caller can fall back, rather than a misleading 0.
eq('unscoreable line returns null', scoreStatLine({ unrelated: 5 }, scoring), null);
// A legitimately negative total must survive (it is not "no data").
eq('negative total is preserved', scoreStatLine({ pass_int: 2 }, scoring), -4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
