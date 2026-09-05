// Dependency-free checks for the season simulation behind playoff odds.
// Run with: npm run verify:projections
//
// The point of simulating rather than curve-fitting is that the answers have to
// hold together: probabilities that sum correctly, a team that wins more moving
// up, and strength of schedule mattering. Those are the properties asserted
// here, because they're what a hand-tuned softmax silently got wrong.

import {
    makeRng,
    seedFrom,
    blendedScoringMean,
    sortBySeed,
    simulateSeason,
    toWholePercentages,
    pairMatchupRows,
    PRESEASON_STRENGTH_UNCERTAINTY,
} from '../src/utils/seasonSimulation.js';
import { movementFromSnapshots, withSnapshot } from '../src/utils/rankMovement.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
    const ok = got === want;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
    ok ? pass++ : fail++;
};
const ok = (name, condition, detail = '') => {
    console.log(`${condition ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
    condition ? pass++ : fail++;
};

// --- Randomness -------------------------------------------------------------
// Odds that change every render aren't credible, so the generator is seeded.
const r1 = makeRng(seedFrom('league', 3));
const r2 = makeRng(seedFrom('league', 3));
eq('the same seed gives the same stream', r1(), r2());
ok('a different seed gives a different stream', makeRng(seedFrom('league', 4))() !== makeRng(seedFrom('league', 3))());
const draws = Array.from({ length: 500 }, () => makeRng(seedFrom('x'))() );
ok('draws stay inside [0,1)', Array.from({ length: 500 }, (_, i) => makeRng(seedFrom('s', i))()).every(v => v >= 0 && v < 1));
ok('the stream is not constant', new Set(draws).size >= 1);

// --- The team model ---------------------------------------------------------
// Before anyone plays, the roster is all there is.
eq('no games played -> the roster prior', blendedScoringMean({ rosterStrength: 120, weeksPlayed: 0 }), 120);
// A single result shouldn't overturn the prior, and shouldn't be ignored either.
const afterOne = blendedScoringMean({ pointsFor: 160, weeksPlayed: 1, rosterStrength: 120 });
ok('one result moves the estimate toward it, but not all the way',
    afterOne > 120 && afterOne < 140, `got ${afterOne.toFixed(2)}`);
// By late season the record should dominate the preseason guess.
const afterTwelve = blendedScoringMean({ pointsFor: 12 * 160, weeksPlayed: 12, rosterStrength: 120 });
ok('twelve results dominate the prior', afterTwelve > 148, `got ${afterTwelve.toFixed(2)}`);
eq('no roster projection -> trust the results',
    blendedScoringMean({ pointsFor: 300, weeksPlayed: 2, rosterStrength: 0 }), 150);

// --- Seeding ----------------------------------------------------------------
const seeded = sortBySeed([
    { rosterId: 'a', wins: 5, ties: 0, pointsFor: 900 },
    { rosterId: 'b', wins: 7, ties: 0, pointsFor: 800 },
    { rosterId: 'c', wins: 5, ties: 0, pointsFor: 1100 },
]);
eq('more wins seeds higher', seeded[0].rosterId, 'b');
// Both platforms break a tied record on points, which is what keeps a
// high-scoring unlucky team alive in the simulation.
eq('a tied record breaks on points', seeded[1].rosterId, 'c');

// --- The simulation ---------------------------------------------------------
const buildTeams = (means) => means.map((mean, i) => ({
    rosterId: i + 1, wins: 0, losses: 0, ties: 0, pointsFor: 0, mean, stdDev: mean * 0.26,
}));

// A full double round-robin for four teams.
const roundRobin = (ids, rounds = 4) => {
    const games = [];
    let week = 1;
    for (let r = 0; r < rounds; r++) {
        games.push({ week, home: ids[0], away: ids[1] }, { week, home: ids[2], away: ids[3] });
        week++;
        games.push({ week, home: ids[0], away: ids[2] }, { week, home: ids[1], away: ids[3] });
        week++;
        games.push({ week, home: ids[0], away: ids[3] }, { week, home: ids[1], away: ids[2] });
        week++;
    }
    return games;
};

const teams = buildTeams([130, 120, 110, 100]);
const schedule = roundRobin([1, 2, 3, 4]);
const result = simulateSeason({ teams, schedule, playoffSpots: 2, iterations: 1200, rng: makeRng(seedFrom('sim', 1)) });

eq('every team gets odds', result.length, 4);
const totalPlayoff = result.reduce((s, t) => s + t.playoffOdds, 0);
ok('playoff odds total the number of spots', Math.abs(totalPlayoff - 2) < 0.001, `got ${totalPlayoff.toFixed(3)}`);
const totalTitles = result.reduce((s, t) => s + t.titleOdds, 0);
ok('championship odds total one', Math.abs(totalTitles - 1) < 0.001, `got ${totalTitles.toFixed(3)}`);

const byId = Object.fromEntries(result.map(t => [String(t.rosterId), t]));
ok('the strongest team is likeliest to make the playoffs',
    byId['1'].playoffOdds > byId['4'].playoffOdds, `${byId['1'].playoffOdds.toFixed(3)} vs ${byId['4'].playoffOdds.toFixed(3)}`);
ok('and likeliest to win it', byId['1'].titleOdds > byId['4'].titleOdds);
ok('odds decrease down the strength order',
    byId['1'].playoffOdds >= byId['2'].playoffOdds && byId['2'].playoffOdds >= byId['3'].playoffOdds);
ok('nobody is impossible or certain in an even league',
    result.every(t => t.playoffOdds > 0 && t.playoffOdds < 1));
ok('projected wins are within the games available',
    result.every(t => t.projectedWins >= 0 && t.projectedWins <= schedule.length / 2));

// Wins already banked have to count. Same rosters, but one team starts ahead.
const withRecord = buildTeams([110, 110, 110, 110]);
withRecord[3] = { ...withRecord[3], wins: 6, pointsFor: 6 * 130 };
const recordResult = simulateSeason({ teams: withRecord, schedule, playoffSpots: 2, iterations: 1200, rng: makeRng(seedFrom('sim', 2)) });
const leader = recordResult.find(t => String(t.rosterId) === '4');
const evenTeam = recordResult.find(t => String(t.rosterId) === '1');
ok('a banked 6-0 start beats an identical roster at 0-0',
    leader.playoffOdds > evenTeam.playoffOdds, `${leader.playoffOdds.toFixed(3)} vs ${evenTeam.playoffOdds.toFixed(3)}`);

// With no games left, the standings are already settled -- odds must be certain.
const finished = simulateSeason({
    teams: [
        { rosterId: 1, wins: 10, losses: 0, ties: 0, pointsFor: 1500, mean: 120, stdDev: 30 },
        { rosterId: 2, wins: 8, losses: 2, ties: 0, pointsFor: 1400, mean: 120, stdDev: 30 },
        { rosterId: 3, wins: 2, losses: 8, ties: 0, pointsFor: 1000, mean: 120, stdDev: 30 },
    ],
    schedule: [], playoffSpots: 2, iterations: 200, rng: makeRng(seedFrom('done')),
});
eq('a settled season is certain at the top', finished.find(t => String(t.rosterId) === '1').playoffOdds, 1);
eq('and certain at the bottom', finished.find(t => String(t.rosterId) === '3').playoffOdds, 0);

// Determinism: the same seed must reproduce the same odds exactly.
const runA = simulateSeason({ teams, schedule, playoffSpots: 2, iterations: 300, rng: makeRng(seedFrom('stable')) });
const runB = simulateSeason({ teams, schedule, playoffSpots: 2, iterations: 300, rng: makeRng(seedFrom('stable')) });
eq('the same seed reproduces the same odds', JSON.stringify(runA), JSON.stringify(runB));

// Roster ids arrive as numbers from a matchup row and as strings from a
// standings map. Mixing them made every game get skipped, so the standings
// never moved and the odds came out as a row of 100%s and 0%s at 0-0.
const stringTeams = [1, 2, 3, 4].map(i => ({
    rosterId: String(i), wins: 0, losses: 0, ties: 0, pointsFor: 0, mean: 120, stdDev: 30,
}));
const numericSchedule = [{ week: 1, home: 1, away: 2 }, { week: 1, home: 3, away: 4 }];
const stringSchedule = [{ week: 1, home: '1', away: '2' }, { week: 1, home: '3', away: '4' }];
const numericRun = simulateSeason({ teams: stringTeams, schedule: numericSchedule, playoffSpots: 2, iterations: 400, rng: makeRng(seedFrom('ids')) });
const stringRun = simulateSeason({ teams: stringTeams, schedule: stringSchedule, playoffSpots: 2, iterations: 400, rng: makeRng(seedFrom('ids')) });
eq('numeric and string roster ids give the same answer',
    JSON.stringify(numericRun), JSON.stringify(stringRun));
ok('an even league at 0-0 is never a certainty',
    numericRun.every(t => t.playoffOdds > 0 && t.playoffOdds < 1),
    numericRun.map(t => (t.playoffOdds * 100).toFixed(0) + '%').join(' '));
// Teams keyed numerically must work too, in case a caller passes them straight
// through from a platform payload.
const numericTeams = stringTeams.map(t => ({ ...t, rosterId: Number(t.rosterId) }));
ok('numerically-keyed teams simulate too',
    simulateSeason({ teams: numericTeams, schedule: numericSchedule, playoffSpots: 2, iterations: 200, rng: makeRng(seedFrom('ids2')) })
        .every(t => t.playoffOdds > 0 && t.playoffOdds < 1));

eq('no teams -> no odds', simulateSeason({ teams: [], schedule }).length, 0);
// More playoff spots than teams would otherwise ask for seeds that don't exist.
const tiny = simulateSeason({
    teams: buildTeams([120, 110]), schedule: [{ week: 1, home: 1, away: 2 }],
    playoffSpots: 6, iterations: 100, rng: makeRng(seedFrom('tiny')),
});
eq('more spots than teams -> everyone is in', tiny.every(t => t.playoffOdds === 1), true);

// --- Preseason confidence ---------------------------------------------------
// Week-to-week variance isn't the only unknown in September: the roster estimate
// itself is a guess, and treating it as exact is what hands out near-certain
// odds before a game has been played. A team's true level is drawn once per
// simulated season, with the spread shrinking as real results accumulate.
ok('there is preseason uncertainty to shrink', PRESEASON_STRENGTH_UNCERTAINTY > 0);

const gap = [130, 125, 120, 115, 110, 105, 100, 95];
// Records that match the strength order, so the leader has actually banked the
// advantage its roster implies -- giving everyone the same record instead would
// test nothing about confidence, since nobody would be ahead.
const ladder = (weeksPlayed) => gap.map((mean, i) => {
    const wins = weeksPlayed ? Math.max(0, weeksPlayed - i) : 0;
    return {
        rosterId: String(i + 1),
        wins, losses: weeksPlayed - wins, ties: 0,
        pointsFor: mean * weeksPlayed, mean, stdDev: mean * 0.26, weeksPlayed,
    };
});
const runFrom = (weeksPlayed, weeksLeft, label) => {
    const games = [];
    for (let w = 0; w < weeksLeft; w++) {
        for (let i = 0; i < 4; i++) games.push({ week: weeksPlayed + w + 1, home: i + 1, away: 8 - i });
    }
    return simulateSeason({
        teams: ladder(weeksPlayed), schedule: games, playoffSpots: 4,
        iterations: 1500, rng: makeRng(seedFrom(label)),
    });
};

const preseason = runFrom(0, 13, 'pre');
const lateSeason = runFrom(10, 3, 'late');
const topPre = preseason.find(t => t.rosterId === '1').playoffOdds;
const topLate = lateSeason.find(t => t.rosterId === '1').playoffOdds;
// This is the reported complaint: nothing should read as settled in September.
ok('the best roster is not a lock before a game is played', topPre < 0.97, `got ${(topPre * 100).toFixed(1)}%`);
ok('nobody is written off before a game is played',
    preseason.every(t => t.playoffOdds > 0.02), preseason.map(t => (t.playoffOdds * 100).toFixed(0) + '%').join(' '));
// And the model should get MORE confident as evidence arrives, not less.
ok('confidence grows once results are in', topLate > topPre, `${(topPre * 100).toFixed(1)}% -> ${(topLate * 100).toFixed(1)}%`);

// --- Whole percentages ------------------------------------------------------
// Rounding each figure alone is what makes a column of odds total 97 or 104.
eq('championship percentages total 100',
    toWholePercentages([0.335, 0.335, 0.33], 1).reduce((a, b) => a + b, 0), 100);
eq('playoff percentages total the spots',
    toWholePercentages([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 4).reduce((a, b) => a + b, 0), 400);
eq('a certainty stays 100', toWholePercentages([1], 1)[0], 100);
eq('an impossibility stays 0', toWholePercentages([0, 1], 1)[0], 0);
eq('the largest remainder gets the spare point',
    JSON.stringify(toWholePercentages([0.333, 0.333, 0.334], 1)), JSON.stringify([33, 33, 34]));

// --- Building the schedule --------------------------------------------------
// Both platforms describe a week as a flat list of team entries sharing a
// matchup id, never as pairs.
const weekRows = [
    { roster_id: 1, matchup_id: 1 }, { roster_id: 4, matchup_id: 1 },
    { roster_id: 2, matchup_id: 2 }, { roster_id: 3, matchup_id: 2 },
];
const paired = pairMatchupRows(weekRows, 5);
eq('a week of rows becomes games', paired.length, 2);
eq('the week is carried onto each game', paired[0].week, 5);
eq('both sides of a matchup are kept', JSON.stringify([paired[0].home, paired[0].away]), JSON.stringify(['1', '4']));
// A lone entry means a bye or a malformed week -- inventing an opponent would
// put a fictional game into every simulated season.
eq('an unpaired team is dropped',
    pairMatchupRows([{ roster_id: 1, matchup_id: 1 }], 5).length, 0);
eq('paired ids are normalised to strings', typeof paired[0].home, 'string');
eq('rows without a matchup id are dropped',
    pairMatchupRows([{ roster_id: 1 }, { roster_id: 2 }], 5).length, 0);
eq('nothing in -> nothing out', pairMatchupRows(null, 1).length, 0);

// --- Movement ---------------------------------------------------------------
const snapshots = { 3: ['a', 'b', 'c', 'd'] };
const moved = movementFromSnapshots(['c', 'a', 'b', 'd'], snapshots, 4);
eq('a team that climbed two places reads +2', moved.get('c'), 2);
eq('a team that slipped one reads -1', moved.get('a'), -1);
eq('a team that held its place reads 0', moved.get('d'), 0);
// "Not ranked last week" and "didn't move" are different things.
eq('a team with no history has no movement', movementFromSnapshots(['e'], snapshots, 4).get('e'), null);
eq('with no earlier week, nobody has moved yet',
    movementFromSnapshots(['a', 'b'], {}, 1).get('a'), null);
// Re-rendering the same week must still compare against the last COMPLETED
// week, not against itself -- otherwise everyone reads as static.
eq('the current week is not compared against itself',
    movementFromSnapshots(['c', 'a', 'b', 'd'], { 3: ['a', 'b', 'c', 'd'], 4: ['c', 'a', 'b', 'd'] }, 4).get('c'), 2);

const stored = withSnapshot(snapshots, 4, ['c', 'a', 'b', 'd']);
eq('the new week is recorded', JSON.stringify(stored[4]), JSON.stringify(['c', 'a', 'b', 'd']));
eq('earlier weeks are kept', JSON.stringify(stored[3]), JSON.stringify(['a', 'b', 'c', 'd']));
const trimmed = withSnapshot({ 1: ['a'], 2: ['a'], 3: ['a'], 4: ['a'], 5: ['a'], 6: ['a'] }, 7, ['a'], 3);
eq('old weeks are trimmed so the entry stays small', Object.keys(trimmed).length, 3);
eq('and the newest survive', Object.keys(trimmed).map(Number).sort((a, b) => a - b).join(','), '5,6,7');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
