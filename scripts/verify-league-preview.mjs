import assert from 'node:assert/strict';

// The sidebar preview names a team and puts a score beside it for every
// league at once. Getting the wrong roster doesn't look broken -- it looks
// like a real matchup that happens to be somebody else's, which a manager
// would act on. These check the identification and pairing logic, which is
// where that failure would come from.
const {
    teamRecord, previewSubtitle, pickMyRosterId, findMatchupPair,
    scoreShare, buildPreview, flattenMatchupMap, attachSleeperTeamNames,
    sleeperOwnerIdsByName,
} = await import('../src/utils/leaguePreview.js');

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

// --- Records ---
check('a record reads W-L', teamRecord({ settings: { wins: 4, losses: 1 } }), '4-1');
check('ties are shown only when there are some',
    teamRecord({ settings: { wins: 4, losses: 1, ties: 1 } }), '4-1-1');
check('a missing settings block reads 0-0 rather than throwing', teamRecord({}), '0-0');
check('a missing roster reads 0-0', teamRecord(null), '0-0');

// --- Subtitle ---
check('a Sleeper PPR league names its size and scoring',
    previewSubtitle({ platform: 'sleeper', total_rosters: 10, settings: { type: 0, rec: 1 } }),
    '10-Team PPR');
check('a keeper league says so',
    previewSubtitle({ platform: 'sleeper', total_rosters: 10, settings: { type: 1, rec: 1 } }),
    '10-Team Keeper PPR');
check('half PPR is distinguished from full',
    previewSubtitle({ platform: 'sleeper', total_rosters: 12, settings: { type: 0, rec: 0.5 } }),
    '12-Team Half PPR');
check('standard scoring omits a scoring word rather than inventing one',
    previewSubtitle({ platform: 'sleeper', total_rosters: 12, settings: { type: 0, rec: 0 } }),
    '12-Team');
// Yahoo publishes no league-format field, so claiming one would be inventing
// data -- see the note at the top of leagueFormat.js.
check('a Yahoo league does not claim a format the platform never reported',
    previewSubtitle({ platform: 'yahoo', total_rosters: 10, settings: { type: 0, rec: 1 } }),
    '10-Team PPR');
check('an unknown league size is left out instead of showing 0-Team',
    previewSubtitle({ platform: 'sleeper', settings: { rec: 1 } }), 'PPR');

// --- Identifying my roster ---
const flaggedRosters = {
    1: { roster_id: 1, team_name: 'Couch Commanders', is_owned_by_current_login: false },
    2: { roster_id: 2, team_name: 'Gridiron Goblins', is_owned_by_current_login: true },
};
check('the platform flag wins when present', pickMyRosterId(flaggedRosters, 'Couch Commanders'), '2');

const namedRosters = {
    1: { roster_id: 1, team_name: 'Couch Commanders' },
    2: { roster_id: 2, team_name: 'Gridiron Goblins' },
};
check('Sleeper falls back to the stored connection name',
    pickMyRosterId(namedRosters, 'Couch Commanders'), '1');
check('name matching ignores case and punctuation',
    pickMyRosterId(namedRosters, "couch  commanders!"), '1');
// Guessing here would put somebody else's matchup under your league.
check('an unmatched name yields no roster rather than the first one',
    pickMyRosterId(namedRosters, 'Some Other Team'), null);
check('a missing connection name yields no roster', pickMyRosterId(namedRosters, null), null);
check('no rosters yields null', pickMyRosterId({}, 'Couch Commanders'), null);

// --- Pairing ---
const week = [
    { roster_id: 1, matchup_id: '1', points: 126.1 },
    { roster_id: 2, matchup_id: '1', points: 89.4 },
    { roster_id: 3, matchup_id: '2', points: 101.0 },
    { roster_id: 4, matchup_id: '2', points: 99.5 },
];
check('my opponent is the other team in my matchup',
    findMatchupPair(week, '1').opponent.roster_id, 2);
check('pairing works from either side', findMatchupPair(week, '2').opponent.roster_id, 1);
check('I am never my own opponent', findMatchupPair(week, '1').opponent.roster_id !== 1, true);
check('a roster not in the week has no matchup', findMatchupPair(week, '9').mine, null);

// A bye: present in the week, but nobody shares the matchup id.
const bye = [{ roster_id: 1, matchup_id: '3', points: 110 }];
check('a bye week finds me but no opponent', findMatchupPair(bye, '1').opponent, null);
check('a bye week still finds my own row', findMatchupPair(bye, '1').mine.roster_id, 1);

// A null matchup_id must not pair two unrelated byes together.
const nullIds = [
    { roster_id: 1, matchup_id: null, points: 110 },
    { roster_id: 2, matchup_id: null, points: 95 },
];
check('teams with no matchup id are not paired with each other',
    findMatchupPair(nullIds, '1').opponent, null);

// --- Score share ---
check('the bar reflects the score split', scoreShare(126.1, 89.4), 58.5);
check('a scoreless matchup splits evenly instead of dividing by zero', scoreShare(0, 0), 50);
check('a shutout is all one side', scoreShare(100, 0), 100);

// --- Assembling the preview ---
const rosters = {
    1: { roster_id: 1, team_name: 'Couch Commanders', avatar: '/a.png', settings: { wins: 4, losses: 1 } },
    2: { roster_id: 2, team_name: 'Gridiron Goblins', avatar: '/b.png', settings: { wins: 2, losses: 3 } },
};
const league = { platform: 'sleeper', total_rosters: 10, settings: { type: 0, rec: 1 } };
const preview = buildPreview({ league, rosters, matchups: week, myRosterId: '1' });

check('the preview names my team', preview.me.name, 'Couch Commanders');
check('the preview carries my record', preview.me.record, '4-1');
check('the preview carries my score', preview.me.score, 126.1);
check('the preview names the opponent', preview.opponent.name, 'Gridiron Goblins');
check('the preview carries the opponent record', preview.opponent.record, '2-3');
check('the preview carries the opponent score', preview.opponent.score, 89.4);
check('the subtitle is included', preview.subtitle, '10-Team PPR');
check('leading is true when I am ahead', preview.leading, true);
check('the bar matches the score split', preview.share, 58.5);

const behind = buildPreview({ league, rosters, matchups: week, myRosterId: '2' });
check('leading is false when I am behind', behind.leading, false);

// Degradation: these return null so the sidebar draws its plain row rather
// than a half-filled one.
check('no matchup for me yields no preview',
    buildPreview({ league, rosters, matchups: week, myRosterId: '9' }), null);
check('an unknown roster yields no preview',
    buildPreview({ league, rosters: {}, matchups: week, myRosterId: '1' }), null);

const byePreview = buildPreview({ league, rosters, matchups: bye, myRosterId: '1' });
check('a bye week still previews my own side', byePreview.me.score, 110);
check('a bye week reports no opponent rather than inventing one', byePreview.opponent, null);

// Opponent present in the matchup list but missing from the roster map: the
// score is real and should still show, under a fallback name.
const partial = buildPreview({
    league, rosters: { 1: rosters[1] }, matchups: week, myRosterId: '1',
});
check('a missing opponent roster still shows the real score', partial.opponent.score, 89.4);
check('a missing opponent roster falls back to a team label', partial.opponent.name, 'Team 2');

// --- Adapter shape ---
check('the matchup map flattens to a list with ids',
    flattenMatchupMap({ 1: [{ roster_id: 1 }, { roster_id: 2 }] }),
    [{ roster_id: 1, matchup_id: '1' }, { roster_id: 2, matchup_id: '1' }]);
check('an empty map flattens to an empty list', flattenMatchupMap({}), []);
check('a null map does not throw', flattenMatchupMap(null), []);

// --- Sleeper team names ---
//
// This is the bug that shipped: Sleeper's /rosters response carries no
// team_name at all (names live on /users, joined by owner_id), so every
// Sleeper roster had an undefined name, the connection name could never
// match one, and not a single Sleeper league showed a preview. Yahoo and
// ESPN were unaffected because their adapters already name the team.
const rawSleeperRosters = {
    1: { roster_id: 1, owner_id: 'u1', settings: { wins: 4, losses: 1 } },
    2: { roster_id: 2, owner_id: 'u2', settings: { wins: 2, losses: 3 } },
};
check('a raw Sleeper roster genuinely has no team name -- this is the bug',
    rawSleeperRosters[1].team_name, undefined);
check('an unnamed Sleeper roster set cannot identify my team',
    pickMyRosterId(rawSleeperRosters, 'Straw Hat Pirates'), null);

// AddLeague stores `metadata.team_name || display_name`, so the join has to
// read the same field or the two sides compare different things.
const sleeperUsers = [
    { user_id: 'u1', display_name: 'gunner', metadata: { team_name: 'Straw Hat Pirates' } },
    { user_id: 'u2', display_name: 'CeeDeezTdz' },
];
const named = attachSleeperTeamNames(rawSleeperRosters, sleeperUsers);
check('the join puts the metadata team name on the roster',
    named[1].team_name, 'Straw Hat Pirates');
check('a user with no metadata team name falls back to their display name',
    named[2].team_name, 'CeeDeezTdz');
check('after the join my roster is identifiable',
    pickMyRosterId(named, 'Straw Hat Pirates'), '1');
check('the join matches the display-name case too',
    pickMyRosterId(named, 'CeeDeezTdz'), '2');
check('the join leaves the rest of the roster intact', named[1].settings.wins, 4);

// Degradation: these must not throw or invent names.
check('no users leaves the rosters untouched',
    attachSleeperTeamNames(rawSleeperRosters, [])[1].team_name, undefined);
check('null users leaves the rosters untouched',
    attachSleeperTeamNames(rawSleeperRosters, null)[1].team_name, undefined);
check('a roster whose owner has no user keeps its shape rather than gaining an empty name',
    attachSleeperTeamNames({ 3: { roster_id: 3, owner_id: 'nobody' } }, sleeperUsers)[3].team_name,
    undefined);
check('a roster with no owner_id at all is left alone',
    attachSleeperTeamNames({ 4: { roster_id: 4 } }, sleeperUsers)[4].team_name, undefined);

// End to end: the real shape a Sleeper league arrives in now previews.
const sleeperWeek = [
    { roster_id: 1, matchup_id: '1', points: 146.0 },
    { roster_id: 2, matchup_id: '1', points: 130.3 },
];
const sleeperPreview = buildPreview({
    league: { platform: 'sleeper', total_rosters: 10, settings: { type: 0, rec: 1 } },
    rosters: named,
    matchups: sleeperWeek,
    myRosterId: pickMyRosterId(named, 'Straw Hat Pirates'),
});
check('a Sleeper league now previews with a real team name',
    sleeperPreview.me.name, 'Straw Hat Pirates');
check('and names the real opponent rather than "Team 2"',
    sleeperPreview.opponent.name, 'CeeDeezTdz');
check('with the real scores', [sleeperPreview.me.score, sleeperPreview.opponent.score], [146, 130.3]);

// --- Identifying a co-owner, and a renamed team ---
//
// The report after the /users join landed was that ONE Sleeper league still
// showed nothing while the rest worked -- a 16-team league, where shared
// rosters are common. Matching on the roster's team_name alone cannot find a
// co-owner: the name on that roster is the PRIMARY owner's, so the stored
// connection name never equals it. The same blind spot catches a manager who
// renamed their team in Sleeper after connecting, since AddLeague stored
// whichever of the two names was set then.
const sixteenTeamUsers = [
    { user_id: 'u1', display_name: 'gunner', metadata: { team_name: 'Straw Hat Pirates' } },
    { user_id: 'u2', display_name: 'CeeDeezTdz' },
    { user_id: 'u3', display_name: 'brotherInLaw', metadata: { team_name: 'Ballers Inc' } },
];
const ownerIds = sleeperOwnerIdsByName(sixteenTeamUsers);
check('a member is findable by their team name', ownerIds.get('strawhatpirates'), 'u1');
check('and by their display name, which is the other thing that gets stored',
    ownerIds.get('gunner'), 'u1');
check('a member with no team name is findable by display name alone',
    ownerIds.get('ceedeeztdz'), 'u2');
check('an unknown name resolves to nobody rather than the first member',
    ownerIds.get('somebodyelse'), undefined);

// The roster belongs to u3; I am a co-owner of it. Its team_name is "Ballers
// Inc" -- not my stored name, under either spelling.
const coOwned = {
    7: { roster_id: 7, owner_id: 'u3', co_owners: ['u1'], team_name: 'Ballers Inc', settings: { wins: 3, losses: 2 } },
    8: { roster_id: 8, owner_id: 'u2', co_owners: null, team_name: 'CeeDeezTdz', settings: { wins: 2, losses: 3 } },
};
check('a name match alone cannot find a co-owned roster -- this is the bug',
    pickMyRosterId(coOwned, 'Straw Hat Pirates'), null);
check('resolving the name to a user id finds the roster I co-own',
    pickMyRosterId(coOwned, 'Straw Hat Pirates', ownerIds), '7');
check('a co-owner is found by their display name too',
    pickMyRosterId(coOwned, 'gunner', ownerIds), '7');
check('the primary owner still matches their own roster',
    pickMyRosterId(coOwned, 'CeeDeezTdz', ownerIds), '8');
// Owning outright must win over co-owning: a manager who co-owns a friend's
// team as well as running their own must get THEIR team's matchup.
const bothRoles = {
    1: { roster_id: 1, owner_id: 'u3', co_owners: ['u1'] },
    2: { roster_id: 2, owner_id: 'u1', co_owners: [] },
};
check('my own roster beats one I merely co-own',
    pickMyRosterId(bothRoles, 'gunner', ownerIds), '2');

// A team renamed in Sleeper after connecting: the stored name is the old
// display name, which no roster carries any more.
const renamed = {
    1: { roster_id: 1, owner_id: 'u2', team_name: 'Brand New Name' },
};
check('a renamed team is still found through the display name on /users',
    pickMyRosterId(renamed, 'CeeDeezTdz', sleeperOwnerIdsByName([
        { user_id: 'u2', display_name: 'CeeDeezTdz', metadata: { team_name: 'Brand New Name' } },
    ])), '1');

// Guessing is still worse than no preview.
check('an owner id that matches no roster yields nothing rather than a guess',
    pickMyRosterId(coOwned, 'brotherInLaw', sleeperOwnerIdsByName([
        { user_id: 'nobody', display_name: 'brotherInLaw' },
    ])), null);
check('no users means no owner index, and the name path still runs',
    pickMyRosterId(coOwned, 'Ballers Inc', sleeperOwnerIdsByName([])), '7');
check('a null user list does not throw', sleeperOwnerIdsByName(null).size, 0);
check('a user with no id is skipped', sleeperOwnerIdsByName([{ display_name: 'ghost' }]).size, 0);

// Display-name collisions: two members called the same thing cannot be told
// apart, and the index must not silently prefer the later one.
const collide = sleeperOwnerIdsByName([
    { user_id: 'first', display_name: 'mike' },
    { user_id: 'second', display_name: 'Mike' },
]);
check('a duplicated display name keeps the first member rather than the last',
    collide.get('mike'), 'first');

// --- Co-owner display names ---
check('a roster whose owner left is named after a co-owner rather than nothing',
    attachSleeperTeamNames(
        { 1: { roster_id: 1, owner_id: null, co_owners: ['u1'] } }, sixteenTeamUsers
    )[1].team_name,
    'Straw Hat Pirates');
check('a roster that still has an owner is NOT renamed after its co-owner',
    attachSleeperTeamNames(
        { 1: { roster_id: 1, owner_id: 'u3', co_owners: ['u1'] } }, sixteenTeamUsers
    )[1].team_name,
    'Ballers Inc');
check('a null co_owners field does not throw',
    attachSleeperTeamNames({ 1: { roster_id: 1, owner_id: null, co_owners: null } }, sixteenTeamUsers)[1].team_name,
    undefined);

// End to end for the 16-team case: a co-owned roster now previews.
const coOwnedPreview = buildPreview({
    league: { platform: 'sleeper', total_rosters: 16, settings: { type: 2, rec: 1 } },
    rosters: coOwned,
    matchups: [
        { roster_id: 7, matchup_id: '4', points: 118.6 },
        { roster_id: 8, matchup_id: '4', points: 121.2 },
    ],
    myRosterId: pickMyRosterId(coOwned, 'Straw Hat Pirates', ownerIds),
});
check('the 16-team co-owned league previews under the roster\'s real name',
    coOwnedPreview.me.name, 'Ballers Inc');
check('and knows I am behind', coOwnedPreview.leading, false);
check('and says it is a 16-team league', coOwnedPreview.subtitle, '16-Team Dynasty PPR');

console.log(`OK: ${checks} league-preview checks passed`);
