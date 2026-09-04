// Dependency-free checks for the "who is actually available" logic.
// Run with: npm run verify:pool
//
// This matters because the failure is silent: if the owned set is wrong or
// incomplete, rostered players are presented as free agents and nothing
// about the page looks broken.

import { buildOwnedIndex, isPlayerOwned } from '../src/utils/playerPool.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
    const ok = got === want;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | got=${got} want=${want}`);
    ok ? pass++ : fail++;
};

const dict = {
    '4046': { fn: 'Patrick', ln: 'Mahomes', sleeper_id: '4046' },
    '6794': { fn: 'Justin', ln: 'Jefferson', sleeper_id: '6794' },
    '1234': { fn: 'Some', ln: 'Guy', sleeper_id: '1234' },
    '9999': { fn: 'Free', ln: 'Agent', sleeper_id: '9999' },
};

// --- Sleeper: roster ids and dictionary ids are both Sleeper ids ---
const sleeperRosters = {
    1: { roster_id: 1, players: ['4046', '6794'], starters: ['4046'], reserve: [], taxi: [] },
    2: { roster_id: 2, players: ['1234'], starters: ['1234'] },
};
const idx = buildOwnedIndex(sleeperRosters, dict);
eq('sleeper: rostered player is owned', isPlayerOwned({ player_id: '4046', fn: 'Patrick', ln: 'Mahomes' }, idx), true);
eq('sleeper: another team\'s player is owned', isPlayerOwned({ player_id: '1234', fn: 'Some', ln: 'Guy' }, idx), true);
eq('sleeper: genuine free agent is not owned', isPlayerOwned({ player_id: '9999', fn: 'Free', ln: 'Agent' }, idx), false);

// --- Yahoo: rosters carry Yahoo ids, the dictionary may key by a Sleeper id ---
const yahooRosters = { 3: { roster_id: 3, players: ['31002', '31003'] } };
const yahooMeta = { '31002': { fn: 'Justin', ln: 'Jefferson' }, '31003': { fn: 'Bijan', ln: 'Robinson' } };
const yIdx = buildOwnedIndex(yahooRosters, yahooMeta, dict);
eq('yahoo: rostered player matched by yahoo id',
    isPlayerOwned({ player_id: '31003', fn: 'Bijan', ln: 'Robinson' }, yIdx), true);
eq('yahoo: crosswalk-missed rostered player still caught by name',
    isPlayerOwned({ player_id: '6794', fn: 'Justin', ln: 'Jefferson' }, yIdx), true);
eq('yahoo: unrostered player is not owned',
    isPlayerOwned({ player_id: '9999', fn: 'Free', ln: 'Agent' }, yIdx), false);
eq('matched through a crosswalked sleeper_id',
    isPlayerOwned({ player_id: 'yahoo-only', sleeper_id: '4046', fn: 'X', ln: 'Y' }, idx), true);

// --- Dynasty: IR and taxi players are rostered too ---
const dynasty = { 5: { roster_id: 5, players: null, starters: [], reserve: ['4046'], taxi: ['6794'] } };
const dIdx = buildOwnedIndex(dynasty, dict);
eq('IR player counts as owned', isPlayerOwned({ player_id: '4046' }, dIdx), true);
eq('taxi player counts as owned', isPlayerOwned({ player_id: '6794' }, dIdx), true);

// --- The dangerous case: rosters never loaded ---
// Nothing is owned, so the entire league would render as free agents. The
// caller has to notice this rather than trusting the empty set.
const emptyIdx = buildOwnedIndex({}, dict);
eq('missing rosters are flagged', emptyIdx.isEmpty, true);
eq('missing rosters mean nothing registers as owned', isPlayerOwned({ player_id: '4046' }, emptyIdx), false);

// --- Partial load: one team's roster failed to come back ---
const partial = { 1: sleeperRosters[1] };
const pIdx = buildOwnedIndex(partial, dict);
eq('loaded team is still owned', isPlayerOwned({ player_id: '4046' }, pIdx), true);
eq('missing team\'s player looks free (why coverage must be checked)',
    isPlayerOwned({ player_id: '1234', fn: 'Some', ln: 'Guy' }, pIdx), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
