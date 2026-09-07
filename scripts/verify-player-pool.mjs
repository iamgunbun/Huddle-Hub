// Dependency-free checks for the "who is actually available" logic.
// Run with: npm run verify:pool
//
// This matters because the failure is silent: if the owned set is wrong or
// incomplete, rostered players are presented as free agents and nothing
// about the page looks broken.

import { buildOwnedIndex, isPlayerOwned, isRosterableNflPlayer, resolvePlayerFromMeta, playerNameKeyNoSuffix, withResolvedPlayerMeta, resolveRosterPlayers, isLessProminentDuplicate, entryOwnsLookupId, playerInitialKey, INITIAL_KEY_PREFIX } from '../src/utils/playerPool.js';
import { findSuccessorLeagueId, pickOwnerId } from '../src/utils/leagueSeason.js';

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

// --- Name matching must tolerate a generational suffix on only one side ---
// The platform (Yahoo/ESPN) roster spells it "Jr."; the shared dictionary's
// entry for the same player doesn't. buildOwnedIndex/isPlayerOwned used to
// have no suffix-tolerant fallback of their own (unlike resolvePlayerFromMeta
// below, which already handled this), so a real rostered player like this
// silently failed to match and leaked through as "available".
const suffixRosters = { 6: { roster_id: 6, players: ['40877'] } };
const suffixMeta = { '40877': { fn: 'Michael', ln: 'Pittman Jr.', pos: 'WR', t: 'IND' } };
const suffixIdx = buildOwnedIndex(suffixRosters, { matchNames: true, nameSources: [suffixMeta, dict] });
eq('rostered player with a suffix on the platform side is still owned (dictionary has none)',
    isPlayerOwned({ player_id: 'dict-only', fn: 'Michael', ln: 'Pittman' }, suffixIdx), true);

const suffixRostersReversed = { 6: { roster_id: 6, players: ['55'] } };
const suffixMetaReversed = { '55': { fn: 'Michael', ln: 'Pittman', pos: 'WR', t: 'IND' } };
const suffixIdxReversed = buildOwnedIndex(suffixRostersReversed, { matchNames: true, nameSources: [suffixMetaReversed, dict] });
eq('rostered player with a suffix on the dictionary side is still owned (platform has none)',
    isPlayerOwned({ player_id: 'dict-only', fn: 'Michael', ln: 'Pittman Jr.' }, suffixIdxReversed), true);

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

// --- Defenses: platforms agree on team abbreviation, not id or full name ---
// A Yahoo roster carries the defense by Yahoo's own numeric id, and Yahoo's
// full name ("San Francisco 49ers") doesn't match Sleeper's own dictionary
// naming for the same defense -- so neither the id check nor the name check
// above can catch a rostered Yahoo defense. The team abbreviation is the one
// thing both platforms agree on.
const yahooDefRosters = { 4: { roster_id: 4, players: ['100304'] } };
const yahooDefMeta = { '100304': { fn: 'San Francisco', ln: '49ers', pos: 'DEF', t: 'SF' } };
const defIdx = buildOwnedIndex(yahooDefRosters, { matchNames: true, nameSources: [yahooDefMeta, dict] });
eq('yahoo: rostered defense caught by team abbreviation even when id and name both miss',
    isPlayerOwned({ pos: 'DEF', t: 'SF', fn: '49ers', ln: '' }, defIdx), true);
eq('yahoo: a different team\'s defense is not owned',
    isPlayerOwned({ pos: 'DEF', t: 'KC', fn: 'Chiefs', ln: '' }, defIdx), false);
eq('yahoo: a non-defense player at the same "team" key is unaffected',
    isPlayerOwned({ pos: 'WR', t: 'SF', fn: 'Some', ln: 'Receiver', player_id: 'not-rostered' }, defIdx), false);
eq('sleeper: defense matching by team never fires without matchNames',
    isPlayerOwned({ pos: 'DEF', t: 'SF', fn: '49ers', ln: '' }, buildOwnedIndex(yahooDefRosters, { nameSources: [yahooDefMeta] })), false);

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

// --- Sleeper mints a new league id each season; follow it forward ---
eq('finds the next season\'s league',
    findSuccessorLeagueId([{ league_id: '2026A', previous_league_id: '2025A' }, { league_id: '2026B' }], '2025A'), '2026A');
eq('already on the current season -> nothing to change',
    findSuccessorLeagueId([{ league_id: '2025A', previous_league_id: '2024A' }], '2025A'), null);
eq('walks forward past an intermediate season',
    findSuccessorLeagueId([
        { league_id: '2026A', previous_league_id: '2025A' },
        { league_id: '2025A', previous_league_id: '2024A' },
    ], '2024A'), '2026A');
eq('unrelated leagues -> null',
    findSuccessorLeagueId([{ league_id: 'X', previous_league_id: 'Y' }], '2025A'), null);
eq('malformed input -> null', findSuccessorLeagueId(null, '2025A'), null);
eq('a cycle terminates instead of hanging',
    findSuccessorLeagueId([{ league_id: 'A', previous_league_id: 'B' }, { league_id: 'B', previous_league_id: 'A' }], 'ZZZ'), null);
eq('takes an owner id off the rosters', pickOwnerId({ 1: { owner_id: 'u1' } }), 'u1');
eq('no owner id -> null', pickOwnerId({ 1: {} }), null);

// --- Folding a platform's own player details in ---------------------------
// A Yahoo id that the crosswalk doesn't cover has no entry in the dictionary at
// all, which is how a transaction ends up reading "Player #40877".
const txnMeta = {
    '40877': { id: '40877', fn: 'Michael', ln: 'Pittman Jr.', pos: 'WR', t: 'IND', headshot: 'https://y/p.png' },
    '99999': { id: '99999', fn: 'Nobody', ln: 'Known', pos: 'WR', t: 'KC' },
};
const foldedIn = withResolvedPlayerMeta(dictWithDef, byName, txnMeta);
eq('the yahoo id now has a name', foldedIn['40877'].fn, 'Michael');
// The dictionary is consulted by name purely to recover the id the image CDN
// needs -- without it the headshot can never resolve.
eq('and a crosswalked sleeper id for the image', foldedIn['40877'].sleeper_id, '99');
eq('the platform name wins over the dictionary', foldedIn['40877'].ln, 'Pittman Jr.');
// A player the dictionary has never heard of still gets a name, just no image.
eq('an unmatched player keeps its name', foldedIn['99999'].fn, 'Nobody');
eq('and has no sleeper id to build an image from', foldedIn['99999'].sleeper_id, null);
eq('existing dictionary entries survive', foldedIn.SF.pos, 'DEF');
eq('no platform meta -> the dictionary unchanged',
    Object.keys(withResolvedPlayerMeta(dictWithDef, byName, {})).length, Object.keys(dictWithDef).length);

// --- Resolving a whole roster ---------------------------------------------
// A plain lookup drops every player the crosswalk misses, so a power ranking
// ends up measuring how much of each roster happened to be crosswalked rather
// than how good it is -- and since that differs per team, it invents a spread.
const projDict = {
    '99': { fn: 'Michael', ln: 'Pittman', pos: 'WR', sleeper_id: '99', wi: { 1: { p: 14 } } },
    '77': { fn: 'Justin', ln: 'Jefferson', pos: 'WR', sleeper_id: '77', wi: { 1: { p: 20 } } },
};
const projByName = { 'michael pittman': projDict['99'], 'justin jefferson': projDict['77'] };
// Roster carries Yahoo ids; only one of them is crosswalked into the dictionary.
const rosterMeta = {
    '40877': { fn: 'Michael', ln: 'Pittman Jr.', pos: 'WR', t: 'IND' },
    '31002': { fn: 'Justin', ln: 'Jefferson', pos: 'WR', t: 'MIN' },
};
const bare = resolveRosterPlayers(['40877', '31002'], projDict, projByName, {});
eq('without platform metadata the roster all but disappears', bare.players.length, 0);

const resolved = resolveRosterPlayers(['40877', '31002'], projDict, projByName, rosterMeta);
eq('with it, every player is found', resolved.players.length, 2);
// Dictionary entries, not the metadata -- only those carry the projections a
// strength estimate is built from.
eq('and they carry their weekly projection', resolved.players[0].wi[1].p, 14);
eq('full coverage is reported', resolved.coverage, 1);

const halfKnown = resolveRosterPlayers(['40877', 'unknown-id'], projDict, projByName, rosterMeta);
eq('an unidentifiable player is counted, not hidden', halfKnown.unresolved, 1);
eq('and coverage says so', halfKnown.coverage, 0.5);
// Sleeper ids hit the dictionary directly and need no metadata at all.
eq('direct ids still resolve', resolveRosterPlayers(['99', '77'], projDict, projByName).players.length, 2);
eq('empty slots are skipped', resolveRosterPlayers(['0', null, undefined], projDict, projByName).players.length, 0);
eq('an empty roster reports full coverage', resolveRosterPlayers([], projDict, projByName).coverage, 1);

// --- Platform-id collisions in the shared dictionary builder ---------------
// A stale/duplicate espn_id or yahoo_id in Sleeper's own crosswalk can give
// two different Sleeper players the same platform id; without a tie-break the
// second one processed silently clobbers the first, which is how an active
// starter can vanish from every page's player search.
eq('nothing there yet -> never a duplicate', isLessProminentDuplicate(undefined, { searchRank: 5 }), false);
eq('a less prominent existing entry loses to a new, more prominent one',
    isLessProminentDuplicate({ searchRank: 5000 }, { searchRank: 12 }), false);
eq('a more prominent existing entry is kept over a less prominent incoming one',
    isLessProminentDuplicate({ searchRank: 12 }, { searchRank: 5000 }), true);
eq('a tie keeps whichever arrived first (the existing one)',
    isLessProminentDuplicate({ searchRank: 500 }, { searchRank: 500 }), true);
eq('missing searchRank on the existing entry treats it as unranked (loses to any real rank)',
    isLessProminentDuplicate({}, { searchRank: 12 }), false);
eq('missing searchRank on the incoming entry treats it as unranked (existing wins)',
    isLessProminentDuplicate({ searchRank: 12 }, {}), true);

// --- Platform-id ownership: a direct hit can be the WRONG player ----------
// On Yahoo/ESPN the dictionary is keyed by that platform's id, falling back to
// the Sleeper id for anyone the crosswalk misses. So a lookup by a real
// platform id can land on a stand-in whose unrelated Sleeper id is the same
// number -- a wrong player, not a missing one.
eq('an entry that owns its platform id beats a stand-in, regardless of rank',
    isLessProminentDuplicate({ ownsPlatformId: true, searchRank: 9000 }, { ownsPlatformId: false, searchRank: 5 }), true);
eq('and a stand-in never holds the slot against the real owner',
    isLessProminentDuplicate({ ownsPlatformId: false, searchRank: 5 }, { ownsPlatformId: true, searchRank: 9000 }), false);
eq('between two owners, the more prominent still wins',
    isLessProminentDuplicate({ ownsPlatformId: true, searchRank: 5 }, { ownsPlatformId: true, searchRank: 9000 }), true);
eq('between two stand-ins, the more prominent still wins',
    isLessProminentDuplicate({ ownsPlatformId: false, searchRank: 5 }, { ownsPlatformId: false, searchRank: 9000 }), true);

eq('an owner entry is trustworthy for a direct id lookup', entryOwnsLookupId({ ownsPlatformId: true }), true);
eq('a stand-in entry is not', entryOwnsLookupId({ ownsPlatformId: false }), false);
eq('an entry from before this flag existed is treated as trustworthy',
    entryOwnsLookupId({ searchRank: 1 }), true);

// A roster full of real platform ids must not silently absorb a stand-in.
const espnDict = {
    // The stand-in: a Sleeper-only player parked at a key that is a real ESPN id.
    '12483': { fn: 'Someone', ln: 'Else', pos: 'WR', sleeper_id: '12483', ownsPlatformId: false, wi: { 1: { p: 99 } } },
    '99': { fn: 'Matthew', ln: 'Stafford', pos: 'QB', sleeper_id: '99', ownsPlatformId: true, wi: { 1: { p: 18 } } },
};
const espnByName = { 'matthew stafford': espnDict['99'] };
const espnMeta = { '12483': { fn: 'Matthew', ln: 'Stafford', pos: 'QB', t: 'LAR' } };
const espnResolved = resolveRosterPlayers(['12483'], espnDict, espnByName, espnMeta);
eq('a roster id landing on a stand-in resolves by name instead',
    espnResolved.players[0].ln, 'Stafford');
eq('and does not credit the roster with the stranger\'s projection',
    espnResolved.players[0].wi[1].p, 18);

// --- Defenses on a platform-keyed dictionary ------------------------------
// On Yahoo/ESPN the dictionary is re-keyed by that platform's player id, so a
// defense carrying one is no longer filed under its team abbreviation -- and
// the abbreviation is the ONLY thing the platforms agree on for a defense.
// The name index carries the alias for exactly this case; without it every
// roster that owns a defense has a hole in it, which understates that team.
const espnKeyedDict = {
    '-16025': { fn: 'San Francisco', ln: '49ers', pos: 'DEF', t: 'SF', sleeper_id: 'SF', ownsPlatformId: true },
};
const espnKeyedByName = { 'san francisco 49ers': espnKeyedDict['-16025'], SF: espnKeyedDict['-16025'] };
eq('a defense still resolves by team when the dictionary is keyed by a platform id',
    resolvePlayerFromMeta({ fn: 'SF', ln: 'D/ST', pos: 'DEF', t: 'SF' }, espnKeyedDict, espnKeyedByName)?.sleeper_id, 'SF');
eq('a defense whose team is not in either index still resolves to null',
    resolvePlayerFromMeta({ fn: 'KC', ln: 'D/ST', pos: 'DEF', t: 'KC' }, espnKeyedDict, espnKeyedByName), null);

// --- First-name mismatches: "Cam" vs "Cameron" ----------------------------
// The platforms disagree at the front of a name more than anywhere else. Last
// name + first initial survives that, but can be genuinely ambiguous, so it's
// only usable when exactly one player matches and the positions agree.
eq('an initial key drops the first name', playerInitialKey('Cameron', 'Ward'), 'c ward');
eq('and is suffix-tolerant too', playerInitialKey('Michael', 'Pittman Jr.'), 'm pittman');
eq('a one-word name has no initial key', playerInitialKey('', 'Cher'), '');

const initialDict = { '1': { fn: 'Cameron', ln: 'Ward', pos: 'QB', sleeper_id: '1' } };
const initialByName = {
    'cameron ward': initialDict['1'],
    [`${INITIAL_KEY_PREFIX}c ward`]: initialDict['1'],
};
eq('a nickname resolves through the initial index',
    resolvePlayerFromMeta({ fn: 'Cam', ln: 'Ward', pos: 'QB' }, initialDict, initialByName)?.sleeper_id, '1');
eq('but not when the positions contradict each other',
    resolvePlayerFromMeta({ fn: 'Cam', ln: 'Ward', pos: 'WR' }, initialDict, initialByName), null);
// An ambiguous key is never written to the index, so it simply isn't there.
eq('an ambiguous last name + initial resolves to nothing',
    resolvePlayerFromMeta({ fn: 'Cam', ln: 'Smith', pos: 'QB' }, initialDict, initialByName), null);

// Unresolved players are named, not just counted.
const namedMeta = { 'x1': { fn: 'Nobody', ln: 'Known', pos: 'WR', t: 'KC' } };
const namedResult = resolveRosterPlayers(['x1'], {}, {}, namedMeta);
eq('an unidentified player is reported by name', namedResult.unresolvedNames[0], 'Nobody Known (WR, id x1)');
eq('and a fully resolved roster reports none',
    resolveRosterPlayers(['1'], initialDict, initialByName, {}).unresolvedNames.length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
