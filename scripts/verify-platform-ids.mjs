import assert from 'node:assert/strict';
import { isYahooLeagueId, isEspnLeagueId, toEspnLeagueId, fromEspnLeagueId, detectPlatform, ESPN_ID_PREFIX } from '../src/utils/platformIds.js';

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

// --- detectPlatform ---
check('detects Yahoo', detectPlatform('461.l.123456'), 'yahoo');
check('detects ESPN', detectPlatform(toEspnLeagueId('123456')), 'espn');
check('falls back to Sleeper for a bare numeric id', detectPlatform('123456'), 'sleeper');
check('ESPN is checked before Yahoo\'s shape check could misfire', detectPlatform(toEspnLeagueId('461')), 'espn');

console.log(`OK: ${checks} platform-id checks passed`);
