import assert from 'node:assert/strict';

// This tool tells a manager which of his players to give away. Getting the
// value of a player wrong does not look like a bug -- it looks like advice.
// The two failures that matter most are checked explicitly: a player the
// projection feed does not cover must never be valued at zero and offered up,
// and a flex slot must never swallow a player a stricter slot needed.
const {
    SLOT_ELIGIBILITY, startingSlots, rosValue, makeRosValue,
    optimalLineup, lineupGain, findTrades, playerLabel,
    blockFit, indexBlocksByRoster, BLOCK_POSITIONS,
} = await import('../src/utils/tradeFinder.js');

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

// A player is just a position and a week-indexed projection, the shape
// loadPlayers() already produces.
const P = (id, pos, pts) => ({ player_id: id, fn: id, ln: '', pos, wi: { 1: { p: pts } } });
const val = makeRosValue([1]);
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN'];

// --- Slots ---
check('bench and IR never score', startingSlots(['QB', 'RB', 'BN', 'IR', 'TAXI']), ['QB', 'RB']);
check('an unknown slot name is ignored rather than crashing the lineup',
    startingSlots(['QB', 'WHAT', 'RB']), ['QB', 'RB']);
check('FLEX accepts the three skill positions', SLOT_ELIGIBILITY.FLEX, ['RB', 'WR', 'TE']);
check('SUPER_FLEX also accepts a quarterback', SLOT_ELIGIBILITY.SUPER_FLEX.includes('QB'), true);

// --- Value ---
check('rest-of-season value is the sum of the weeks left',
    rosValue({ wi: { 5: { p: 10 }, 6: { p: 12.5 } } }, [5, 6]), 22.5);
check('weeks already played are not counted',
    rosValue({ wi: { 1: { p: 99 }, 5: { p: 10 } } }, [5]), 10);
check('a string projection is parsed, not concatenated',
    rosValue({ wi: { 5: { p: '10.5' } } }, [5]), 10.5);
// THE guard. A crosswalk gap on a Yahoo or ESPN league leaves a real starter
// with no wi entry; scoring him 0 would put him top of the "give away" list.
check('a player with no projection at all is null, never zero',
    rosValue({ wi: {} }, [5]), null);
check('a missing wi block is null, never zero', rosValue({}, [5]), null);
check('a null player is null', rosValue(null, [5]), null);
check('partial coverage still returns what is known',
    rosValue({ wi: { 5: { p: 10 } } }, [5, 6, 7]), 10);

// --- Optimal lineup ---
const myTeam = [
    P('qb1', 'QB', 20), P('rb1', 'RB', 18), P('rb2', 'RB', 15), P('rb3', 'RB', 13),
    P('rb4', 'RB', 12), P('wr1', 'WR', 14), P('wr2', 'WR', 8), P('wr3', 'WR', 6),
    P('te1', 'TE', 9),
];
// Hand-worked: QB20 + RB18 + RB15 + WR14 + WR8 + TE9 + FLEX(best left = RB13).
check('the optimal lineup is the best legal one', optimalLineup(myTeam, SLOTS, val).score, 97);
check('FLEX takes the best remaining skill player',
    optimalLineup(myTeam, SLOTS, val).filled.find(f => f.slot === 'FLEX').value, 13);
check('every starting slot is reported', optimalLineup(myTeam, SLOTS, val).filled.length, 7);

// Filling in array order is only correct while strict slots happen to come
// first. Here SUPER_FLEX is listed first, and in array order it eats the only
// quarterback -- leaving the QB slot empty and the lineup 16 points light.
const sfRoster = [P('qb', 'QB', 20), P('rb1', 'RB', 18), P('rb2', 'RB', 16), P('wr', 'WR', 14), P('te', 'TE', 9)];
const sfSlots = ['SUPER_FLEX', 'QB', 'RB', 'WR', 'TE'];
check('a flex listed first does not swallow the only quarterback',
    optimalLineup(sfRoster, sfSlots, val).score, 77);
check('and the QB slot really is filled by the quarterback',
    optimalLineup(sfRoster, sfSlots, val).filled.find(f => f.slot === 'QB').player.player_id, 'qb');
check('the order slots are listed in does not change the score',
    optimalLineup(sfRoster, ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX'], val).score,
    optimalLineup(sfRoster, sfSlots, val).score);

check('a position nobody can fill scores zero instead of throwing',
    optimalLineup([P('qb', 'QB', 20)], ['QB', 'RB'], val).score, 20);
check('an unprojected player is left out of the lineup entirely',
    optimalLineup([P('qb', 'QB', 20), { player_id: 'ghost', pos: 'RB', wi: {} }], ['QB', 'RB'], val).score, 20);

// --- Gain: this is where "need" comes from ---
const theirTeam = [
    P('tqb', 'QB', 19), P('trb1', 'RB', 11), P('trb2', 'RB', 7), P('twr1', 'WR', 17),
    P('twr2', 'WR', 16), P('twr3', 'WR', 15), P('twr4', 'WR', 12), P('tte', 'TE', 10),
];
check('their lineup before any trade', optimalLineup(theirTeam, SLOTS, val).score, 95);

const myRb3 = myTeam.find(p => p.player_id === 'rb3');
const theirWr3 = theirTeam.find(p => p.player_id === 'twr3');
// I am deep at RB and thin at WR; they are the mirror image. 97 -> 103.
check('receiving at a thin position is a real gain',
    lineupGain({ players: myTeam, give: [myRb3], get: [theirWr3], slots: SLOTS, valueOf: val }), 6);
// 95 -> 98.
check('and the same swap helps them too',
    lineupGain({ players: theirTeam, give: [theirWr3], get: [myRb3], slots: SLOTS, valueOf: val }), 3);
// The surplus test: RB4 never cracks this lineup, so losing him costs nothing.
check('giving away a player who never starts costs nothing',
    lineupGain({ players: myTeam, give: [myTeam.find(p => p.player_id === 'rb4')], get: [], slots: SLOTS, valueOf: val }), 0);
// -6, not -3: losing the best back cascades through every RB-eligible slot.
// The lineup used {18,15,13} and now uses {15,13,12}.
check('giving away a starter is a real loss, and it cascades',
    lineupGain({ players: myTeam, give: [myTeam.find(p => p.player_id === 'rb1')], get: [], slots: SLOTS, valueOf: val }), -6);

// --- Finding ---
const me = { rosterId: '1', teamName: 'Couch Commanders', players: myTeam };
const them = { rosterId: '2', teamName: 'Gridiron Goblins', players: theirTeam };
const found = findTrades({ me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1 });

check('it finds trades', found.proposals.length > 0, true);
check('every proposal helps me', found.proposals.every(p => p.gainMe > 0), true);
check('and every proposal helps them -- otherwise it is not a trade, it is a wish',
    found.proposals.every(p => p.gainThem > 0), true);
check('the headline number is the weaker side, not the total',
    found.proposals[0].mutual, Math.min(found.proposals[0].gainMe, found.proposals[0].gainThem));
check('results are ranked by that weaker side',
    found.proposals.map(p => p.mutual).every((m, i, a) => i === 0 || a[i-1] >= m), true);
check('the hand-worked swap is in there',
    found.proposals.some(p => p.give[0].player_id === 'rb3' && p.get[0].player_id === 'twr3'), true);
check('proposals name the opponent', found.proposals[0].opponent, 'Gridiron Goblins');

// A lopsided package is declined on sight by a real manager, so it should
// never reach the list however much it would help me.
const greedy = findTrades({
    me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1, fairness: 0.01,
});
check('a tight fairness band rules out lopsided packages',
    greedy.proposals.every(p => p.fairnessGap <= 0.01), true);
check('fairness is measured on value exchanged, not on gain',
    found.proposals.every(p => p.fairnessGap <= 0.35), true);

// THE guard, end to end: an unprojected player must not be offered to anybody.
const ghost = { player_id: 'ghost', fn: 'Ghost', ln: 'Player', pos: 'WR', wi: {} };
const withGhost = findTrades({
    me: { ...me, players: [...myTeam, ghost] }, opponents: [them],
    slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1,
});
check('a player with no projection is never offered in a trade',
    withGhost.proposals.some(p => p.give.some(g => g.player_id === 'ghost')), false);
check('and he is reported, not silently dropped',
    withGhost.excluded.some(e => e.player === 'Ghost Player'), true);
check('the exclusion says which team he was on',
    withGhost.excluded.find(e => e.player === 'Ghost Player').team, 'Couch Commanders');

check('the limit is respected',
    findTrades({ me, opponents: [them], slots: SLOTS, valueOf: val, limit: 2 }).proposals.length <= 2, true);
check('no opponents yields nothing rather than throwing',
    findTrades({ me, opponents: [], slots: SLOTS, valueOf: val }).proposals, []);
check('an empty roster yields nothing rather than throwing',
    findTrades({ me: { players: [] }, opponents: [them], slots: SLOTS, valueOf: val }).proposals, []);
check('a call with no arguments does not throw', findTrades().proposals, []);
check('the search reports how much it looked at',
    findTrades({ me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1 }).considered > 0, true);

// Two-for-one has to be reachable: that is how a surplus actually gets moved.
const bundles = findTrades({ me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 2, maxGet: 1 });
check('packaging two players for one is considered',
    bundles.proposals.some(p => p.give.length === 2), true);
check('a package never offers the same player twice',
    bundles.proposals.every(p => new Set(p.give.map(g => g.player_id)).size === p.give.length), true);

check('a player label falls back to an id rather than rendering blank',
    playerLabel({ player_id: '4046' }), '4046');

// --- Trade block ---
//
// What a manager declares can reorder the list. It must never be able to
// CREATE an entry: only the lineup maths decides whether a trade helps both
// sides, so a declared want can lift a real trade up the page and nothing
// more. The first check below is the one that protects that.
const noBlocks = findTrades({ me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1 });
const emptyBlocks = findTrades({
    me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1,
    blocks: { '2': { shopping: [], needs: [], players: [] } },
});
check('an empty block changes nothing at all',
    emptyBlocks.proposals.map(p => `${p.give[0].player_id}>${p.get[0].player_id}`),
    noBlocks.proposals.map(p => `${p.give[0].player_id}>${p.get[0].player_id}`));
check('with no blocks the score is just the mutual gain',
    noBlocks.proposals.every(p => p.score === p.mutual), true);
check('and no trade claims a fit it does not have',
    noBlocks.proposals.every(p => p.fit === 0 && p.fitReasons.length === 0), true);

// They said they need a running back and are shopping receivers -- which is
// exactly the hand-worked swap, so it should be lifted, with its reasons.
const declared = findTrades({
    me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1,
    blocks: { '2': { shopping: ['WR'], needs: ['RB'], players: [] } },
});
const top = declared.proposals[0];
check('the declared match is ranked first', [top.give[0].pos, top.get[0].pos], ['RB', 'WR']);
check('and it says why', top.fitReasons.sort(), ["they need RB", "they're shopping WR"]);
check('the score is exactly the gain times the declared-want premium',
    top.score, Math.round(top.mutual * (1 + 0.75 * top.fit) * 100) / 100);
check('and the premium is bounded however much is declared',
    top.score <= top.mutual * 1.75 + 0.01, true);
check('the underlying gains are untouched by the declaration',
    [top.gainMe, top.gainThem],
    [noBlocks.proposals.find(p => p.give[0].pos === 'RB' && p.get[0].pos === 'WR').gainMe,
     noBlocks.proposals.find(p => p.give[0].pos === 'RB' && p.get[0].pos === 'WR').gainThem]);
// A declaration must not drag a losing trade into the list.
check('a block never adds a trade that was not already mutually positive',
    declared.proposals.every(p => p.gainMe > 0 && p.gainThem > 0), true);
check('and never adds trades that were not there without it',
    declared.proposals.length <= noBlocks.proposals.length, true);

// --- blockFit: a match is a HANDSHAKE, not a single signal ---
//
// Reported as results that did not look like they matched the blocks. The
// cause was scoring the four signals independently and adding them, so one
// lone "they need RB" boosted a trade while nothing said the sender would
// part with a back or wanted anything coming the other way. Both legs --
// something they want going out, something you want coming back -- now have
// to connect, and these are the checks that hold that line.
const prop = { give: [P('g', 'RB', 10)], get: [P('h', 'WR', 10)] };
const NO_FIT = { fit: 0, reasons: [], legs: { outbound: 0, inbound: 0 } };

check('no block at all is no fit', blockFit(prop, null), NO_FIT);
check('no block on either side is no fit', blockFit(prop, null, null), NO_FIT);

// ONE-WAY: each of these is half a trade, and none of them should count.
check('"they need what I am sending" alone is not a match',
    blockFit(prop, { needs: ['RB'] }), NO_FIT);
check('"they are shopping what I am taking" alone is not a match',
    blockFit(prop, { shopping: ['WR'] }), NO_FIT);
check('"I need what I am getting" alone is not a match',
    blockFit(prop, null, { needs: ['WR'] }), NO_FIT);
check('"I would move what I am sending" alone is not a match',
    blockFit(prop, null, { shopping: ['RB'] }), NO_FIT);
check('a one-way signal carries no reasons either, so nothing can claim a match it does not have',
    blockFit(prop, { needs: ['RB'] }).reasons, []);

// TWO-WAY: both legs connect.
const theirs = blockFit(prop, { needs: ['RB'], shopping: ['WR'] });
check('their need plus their shopping list is a two-way match', theirs.fit, 0.5);
check('and it names both legs', theirs.reasons.sort(), ['they need RB', "they're shopping WR"]);

const mine = blockFit(prop, null, { shopping: ['RB'], needs: ['WR'] });
check('my own block can complete the handshake by itself', mine.fit, 0.5);
check('and it names both legs too', mine.reasons.sort(), ["you need WR", "you're shopping RB"]);

const across = blockFit(prop, { needs: ['RB'] }, { needs: ['WR'] });
check('one leg from each manager is still a handshake', across.fit, 0.5);
check('their outbound and my inbound', across.reasons.sort(), ['they need RB', 'you need WR']);

// All four declarations agreeing is the strongest case there is.
const full = blockFit(prop, { needs: ['RB'], shopping: ['WR'] }, { shopping: ['RB'], needs: ['WR'] });
check('all four declarations agreeing is a perfect fit', full.fit, 1);
check('both legs are full', full.legs, { outbound: 1, inbound: 1 });
check('a perfect fit beats a thin one', full.fit > theirs.fit, true);

// A named player settles the inbound leg, but still needs an outbound one.
const namedOnly = blockFit(prop, { players: ['h'] });
check('a named player alone is still only half a trade', namedOnly, NO_FIT);
const namedPlusOut = blockFit(prop, { players: ['h'], needs: ['RB'] });
check('a named player with an outbound leg matches', namedPlusOut.fit, 0.75);
check('and the named signal fills the inbound leg on its own', namedPlusOut.legs.inbound, 1);

check('a need for something the trade does not move does not count',
    blockFit(prop, { needs: ['TE'], shopping: ['WR'] }), NO_FIT);
check('fit never exceeds 1',
    blockFit(prop, { needs: ['RB'], shopping: ['WR'], players: ['h'] },
        { shopping: ['RB'], needs: ['WR'] }).fit, 1);
check('a reason is never repeated',
    blockFit(prop, { needs: ['RB', 'RB'], shopping: ['WR'] }).reasons.sort(),
    ['they need RB', "they're shopping WR"]);
check('every declarable position is a real lineup position',
    BLOCK_POSITIONS.every(pos => Object.values(SLOT_ELIGIBILITY).some(e => e.includes(pos))), true);

// --- Joining blocks to rosters ---
const rosters = {
    1: { roster_id: 1, team_name: 'Couch Commanders' },
    2: { roster_id: 2, team_name: 'Gridiron Goblins' },
};
const claims = [{ user_id: 'u1', team_name: 'Couch Commanders' }, { user_id: 'u2', team_name: 'Gridiron Goblins' }];
const rows = [{ user_id: 'u2', needs: ['RB'], shopping: ['WR'], players: [] }];
check('a declared block lands on the right roster',
    Object.keys(indexBlocksByRoster(rosters, claims, rows)), ['2']);
check('the block content survives the join',
    indexBlocksByRoster(rosters, claims, rows)['2'].needs, ['RB']);
check('name matching ignores case and punctuation',
    Object.keys(indexBlocksByRoster(rosters, [{ user_id: 'u2', team_name: 'gridiron  goblins!' }], rows)), ['2']);
check('a manager with no block is simply absent',
    indexBlocksByRoster(rosters, claims, rows)['1'], undefined);
check('no blocks yields an empty index, not a crash', indexBlocksByRoster(rosters, claims, []), {});
check('a claim whose team is not in the league is dropped rather than guessed',
    indexBlocksByRoster(rosters, [{ user_id: 'u2', team_name: 'Some Other Team' }], rows), {});
check('null arguments do not throw', indexBlocksByRoster(null, null, null), {});

// --- Your own block ---
//
// The first version weighed only the opponent's declaration, so a manager
// could set their own block, re-run, and watch nothing move. That is exactly
// what got reported, and it is what these cover.
const mineOnly = findTrades({
    me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1,
    myBlock: { needs: ['WR'], shopping: ['RB'] },
});
check('my own block changes my own results', mineOnly.proposals[0].fit > 0, true);
check('a position I said I need, that I would be getting, counts',
    mineOnly.proposals[0].fitReasons.includes('you need WR'), true);
check('a position I said I would move, that I would be giving, counts',
    mineOnly.proposals[0].fitReasons.includes("you're shopping RB"), true);
check('my block alone still cannot add a trade that hurts either side',
    mineOnly.proposals.every(p => p.gainMe > 0 && p.gainThem > 0), true);
check('an empty block of my own is still no boost',
    findTrades({ me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1,
        myBlock: { needs: [], shopping: [] } }).proposals.every(p => p.fit === 0), true);
check('a need of mine for something the trade does not bring me does not count',
    blockFit({ give: [P('g', 'RB', 1)], get: [P('h', 'WR', 1)] }, null, { needs: ['TE'] }).fit, 0);
// The reported case, stated directly: half a handshake must not rank.
check('one of my own signals alone does not make a match either',
    findTrades({ me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1,
        myBlock: { needs: ['WR'], shopping: [] } }).proposals.every(p => p.fit === 0), true);
check('both blocks can contribute to one handshake',
    blockFit({ give: [P('g', 'RB', 1)], get: [P('h', 'WR', 1)] },
        { needs: ['RB'] }, { needs: ['WR'] }).reasons.sort(),
    ['they need RB', 'you need WR']);
check('no blocks at all on either side is still no fit',
    blockFit({ give: [], get: [] }, null, null).fit, 0);

// --- Matching-only ---
const onlyMatching = findTrades({
    me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1,
    blocks: { '2': { shopping: ['WR'], needs: ['RB'] } }, matchingOnly: true,
});
check('matching-only keeps just the declared ones',
    onlyMatching.proposals.every(p => p.fit > 0), true);
// In this fixture my team is RB-heavy and theirs WR-heavy, so EVERY
// mutually-positive trade is RB-for-WR and matches the declared want --
// there is nothing for the filter to remove. Asserting it shrinks the list
// tested the fixture, not the filter. A want that only some trades satisfy
// is what actually exercises it.
const narrow = { needs: ['TE'] };
const narrowAll = findTrades({
    me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1, blocks: { '2': narrow },
});
const narrowOnly = findTrades({
    me, opponents: [them], slots: SLOTS, valueOf: val, maxGive: 1, maxGet: 1,
    blocks: { '2': narrow }, matchingOnly: true,
});
check('matching-only keeps exactly the trades that matched',
    narrowOnly.proposals.length, narrowAll.proposals.filter(p => p.fit > 0).length);
check('and it genuinely drops the rest',
    narrowAll.proposals.length > narrowOnly.proposals.length, true);
check('matching-only with nothing declared anywhere returns nothing, not everything',
    findTrades({ me, opponents: [them], slots: SLOTS, valueOf: val, matchingOnly: true }).proposals, []);
check('the filter never changes the gains of what survives it',
    onlyMatching.proposals[0].gainMe,
    declared.proposals.find(p => p.give[0].player_id === onlyMatching.proposals[0].give[0].player_id
        && p.get[0].player_id === onlyMatching.proposals[0].get[0].player_id).gainMe);

console.log(`OK: ${checks} trade-finder checks passed`);
