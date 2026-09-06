import assert from 'node:assert/strict';
import { isYahooLeagueId, isEspnLeagueId, toEspnLeagueId, toEspnSeasonLeagueId, parseEspnLeagueId, fromEspnLeagueId, detectPlatform, isForeignPlatformLeague, sleeperFeedKey, ESPN_ID_PREFIX } from '../src/utils/platformIds.js';

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

// --- isYahooLeagueId ---
check('a Yahoo-shaped id (game_key.l.league_id) is recognised', isYahooLeagueId('461.l.123456'), true);
check('a bare Sleeper numeric id is not Yahoo', isYahooLeagueId('987654321'), false);
check('an ESPN-prefixed id is not Yahoo, even though it has no dot', isYahooLeagueId(toEspnLeagueId('123456')), false);
check('null is not Yahoo', isYahooLeagueId(null), false);
check('empty string is not Yahoo', isYahooLeagueId(''), false);

// --- isEspnLeagueId / toEspnLeagueId / fromEspnLeagueId ---
check('a prefixed id is recognised as ESPN', isEspnLeagueId('espn:123456'), true);
check('a bare numeric id is not ESPN', isEspnLeagueId('123456'), false);
check('a Yahoo id is not ESPN', isEspnLeagueId('461.l.123456'), false);
check('non-string input is never ESPN', isEspnLeagueId(123456), false);
check('null is not ESPN', isEspnLeagueId(null), false);

check('wrapping produces the expected prefix', toEspnLeagueId('123456'), `${ESPN_ID_PREFIX}123456`);
check('wrapping coerces a numeric id to a string', toEspnLeagueId(123456), 'espn:123456');
check('unwrapping strips the prefix', fromEspnLeagueId('espn:123456'), '123456');
check('unwrapping a not-yet-prefixed id is a no-op', fromEspnLeagueId('123456'), '123456');
check('unwrapping null does not throw', fromEspnLeagueId(null), '');
check('round trip: wrap then unwrap returns the original', fromEspnLeagueId(toEspnLeagueId('999')), '999');

// --- season-qualified ESPN ids (past-season history walk) ---
check('a season-qualified id is still recognised as ESPN', isEspnLeagueId(toEspnSeasonLeagueId('123456', 2024)), true);
check('a season-qualified id is not Yahoo-shaped', isYahooLeagueId(toEspnSeasonLeagueId('123456', 2024)), false);
check('season-qualified wrapping produces the expected form', toEspnSeasonLeagueId('123456', 2024), 'espn:123456:2024');
check('parsing a season-qualified id splits id and year', parseEspnLeagueId('espn:123456:2024'), { leagueId: '123456', year: 2024 });
check('parsing the current-season form has no year', parseEspnLeagueId('espn:123456'), { leagueId: '123456', year: null });
check('parsing a bare not-yet-prefixed id still works', parseEspnLeagueId('123456'), { leagueId: '123456', year: null });
check('parsing null does not throw', parseEspnLeagueId(null), { leagueId: '', year: null });
check('unwrapping a season-qualified id still returns the bare numeric id', fromEspnLeagueId(toEspnSeasonLeagueId('123456', 2024)), '123456');
check('detects ESPN for a season-qualified id', detectPlatform(toEspnSeasonLeagueId('123456', 2024)), 'espn');

// --- detectPlatform ---
check('detects Yahoo', detectPlatform('461.l.123456'), 'yahoo');
check('detects ESPN', detectPlatform(toEspnLeagueId('123456')), 'espn');
check('falls back to Sleeper for a bare numeric id', detectPlatform('123456'), 'sleeper');
check('ESPN is checked before Yahoo\'s shape check could misfire', detectPlatform(toEspnLeagueId('461')), 'espn');

// --- isForeignPlatformLeague / sleeperFeedKey ---
// The id spaces OVERLAP, so a foreign id looked up in a Sleeper-keyed feed
// doesn't miss -- it returns an unrelated player's stat line, which is how a
// QB ends up showing receptions and receiving yards.
check('an ESPN league is a foreign platform', isForeignPlatformLeague(toEspnLeagueId('123456')), true);
check('a Yahoo league is a foreign platform', isForeignPlatformLeague('461.l.123456'), true);
check('a Sleeper league is not', isForeignPlatformLeague('987654321'), false);

check('the crosswalked sleeper_id is always preferred',
    sleeperFeedKey({ sleeper_id: '4046', player_id: '12483' }, '12483', true), '4046');
check('on a foreign platform an uncrosswalked player gets NO key, never the raw id',
    sleeperFeedKey({ player_id: '12483' }, '12483', true), null);
check('the raw id is still usable on a native Sleeper league',
    sleeperFeedKey({ player_id: '4046' }, '4046', false), '4046');
check('no player object at all on Sleeper still falls back to the raw id',
    sleeperFeedKey(null, '4046', false), '4046');
check('no player object on a foreign platform yields nothing to look up',
    sleeperFeedKey(null, '12483', true), null);
check('a numeric sleeper_id is coerced to the string key the feeds use',
    sleeperFeedKey({ sleeper_id: 4046 }, '12483', true), '4046');
check('an empty sleeper_id is not treated as a real key',
    sleeperFeedKey({ sleeper_id: '' }, '12483', true), null);

console.log(`OK: ${checks} platform-id checks passed`);
