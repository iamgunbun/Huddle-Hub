// Dependency-free checks for the "who is actually available" logic.
// Run with: npm run verify:pool
//
// This matters because the failure is silent: if the owned set is wrong or
// incomplete, rostered players are presented as free agents and nothing
// about the page looks broken.

import { buildOwnedIndex, isPlayerOwned, isRosterableNflPlayer, resolvePlayerFromMeta, playerNameKeyNoSuffix } from '../src/utils/playerPool.js';

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
const idx = buildOwnedIndex(sleeperRosters, { nameSources: [dict] }); // sleeper: ids only
eq('sleeper: rostered player is owned', isPlayerOwned({ player_id: '4046', fn: 'Patrick', ln: 'Mahomes' }, idx), true);
eq('sleeper: another team\'s player is owned', isPlayerOwned({ player_id: '1234', fn: 'Some', ln: 'Guy' }, idx), true);
eq('sleeper: genuine free agent is not owned', isPlayerOwned({ player_id: '9999', fn: 'Free', ln: 'Agent' }, idx), false);

// --- Yahoo: rosters carry Yahoo ids, the dictionary may key by a Sleeper id ---
const yahooRosters = { 3: { roster_id: 3, players: ['31002', '31003'] } };
const yahooMeta = { '31002': { fn: 'Justin', ln: 'Jefferson' }, '31003': { fn: 'Bijan', ln: 'Robinson' } };
const yIdx = buildOwnedIndex(yahooRosters, { matchNames: true, nameSources: [yahooMeta, dict] });
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
const dIdx = buildOwnedIndex(dynasty, { nameSources: [dict] });
eq('IR player counts as owned', isPlayerOwned({ player_id: '4046' }, dIdx), true);
eq('taxi player counts as owned', isPlayerOwned({ player_id: '6794' }, dIdx), true);

// --- The dangerous case: rosters never loaded ---
// Nothing is owned, so the entire league would render as free agents. The
// caller has to notice this rather than trusting the empty set.
const emptyIdx = buildOwnedIndex({}, { nameSources: [dict] });
eq('missing rosters are flagged', emptyIdx.isEmpty, true);
eq('missing rosters mean nothing registers as owned', isPlayerOwned({ player_id: '4046' }, emptyIdx), false);

// --- Partial load: one team's roster failed to come back ---
const partial = { 1: sleeperRosters[1] };
const pIdx = buildOwnedIndex(partial, { nameSources: [dict] });
eq('loaded team is still owned', isPlayerOwned({ player_id: '4046' }, pIdx), true);
eq('missing team\'s player looks free (why coverage must be checked)',
    isPlayerOwned({ player_id: '1234', fn: 'Some', ln: 'Guy' }, pIdx), false);

// --- Name matching must NOT apply to Sleeper, where ids already line up ---
// Two different players share a name; one is rostered, the other is a genuine
// free agent. On Sleeper the free agent must stay available.
const sameName = { 7: { roster_id: 7, players: ['4046'] } };
const sleeperNameIdx = buildOwnedIndex(sameName, { nameSources: [dict] });
eq('sleeper: namesake free agent is NOT hidden',
    isPlayerOwned({ player_id: '8888', fn: 'Patrick', ln: 'Mahomes' }, sleeperNameIdx), false);
eq('sleeper: the actually-rostered player is still owned',
    isPlayerOwned({ player_id: '4046', fn: 'Patrick', ln: 'Mahomes' }, sleeperNameIdx), true);

// --- Only players currently on an NFL roster are available ---
eq('active player on a team is rosterable',
    isRosterableNflPlayer({ fn: 'A', ln: 'B', t: 'KC', active: true, status: 'Active' }), true);
eq('retired player is not rosterable',
    isRosterableNflPlayer({ fn: 'Peyton', ln: 'Manning', t: null, active: false, status: 'Inactive' }), false);
eq('player with no NFL team is not rosterable',
    isRosterableNflPlayer({ fn: 'Some', ln: 'Guy', t: 'FA', active: true, status: 'Active' }), false);
eq('explicitly inactive is not rosterable',
    isRosterableNflPlayer({ fn: 'X', ln: 'Y', t: 'KC', active: true, status: 'Inactive' }), false);
eq('active:false overrides a team',
    isRosterableNflPlayer({ fn: 'X', ln: 'Y', t: 'KC', active: false, status: 'Active' }), false);
eq('team defense is rosterable',
    isRosterableNflPlayer({ fn: 'San Francisco', ln: '', t: 'SF', active: true, status: 'Active' }), true);
eq('injured but rostered player stays available',
    isRosterableNflPlayer({ fn: 'X', ln: 'Y', t: 'BUF', active: true, status: 'Injured Reserve' }), true);

// --- Resolving a roster entry back to a dictionary record ---
// Team defenses: Sleeper keys them by team abbreviation and gives them no
// yahoo_id, so a Yahoo defense can only be matched on the team.
const dictWithDef = {
    SF: { fn: 'San Francisco', ln: '49ers', pos: 'DEF', t: 'SF', sleeper_id: 'SF' },
    '99': { fn: 'Michael', ln: 'Pittman', pos: 'WR', t: 'IND', sleeper_id: '99', searchRank: 50 },
};
const byName = {
    'san francisco 49ers': dictWithDef.SF,
    'michael pittman': dictWithDef['99'],
};
eq('yahoo defense resolves via team abbreviation',
    resolvePlayerFromMeta({ fn: 'San Francisco', ln: '', pos: 'DEF', t: 'SF' }, dictWithDef, byName)?.sleeper_id, 'SF');
eq('name suffix mismatch still resolves',
    resolvePlayerFromMeta({ fn: 'Michael', ln: 'Pittman Jr.', pos: 'WR', t: 'IND' }, dictWithDef, byName)?.sleeper_id, '99');
eq('unknown player resolves to null',
    resolvePlayerFromMeta({ fn: 'Nobody', ln: 'Here', pos: 'WR', t: 'KC' }, dictWithDef, byName), null);
eq('suffix stripper keeps real two-part names',
    playerNameKeyNoSuffix('Justin', 'Jefferson'), 'justin jefferson');
eq('suffix stripper removes Jr',
    playerNameKeyNoSuffix('Michael', 'Pittman Jr.'), 'michael pittman');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
