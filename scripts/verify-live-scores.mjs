import assert from 'node:assert/strict';
import { isViewingLiveWeek, LIVE_SCORE_POLL_MS, formatKickoffTime } from '../src/utils/liveScores.js';

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

check(
    'viewing the live regular-season week polls',
    isViewingLiveWeek({ season_type: 'regular', display_week: 5 }, 5),
    true
);
check(
    'viewing a past week does not poll',
    isViewingLiveWeek({ season_type: 'regular', display_week: 5 }, 3),
    false
);
check(
    'viewing a future week does not poll',
    isViewingLiveWeek({ season_type: 'regular', display_week: 5 }, 9),
    false
);
check(
    'the live playoff week polls too',
    isViewingLiveWeek({ season_type: 'post', display_week: 15 }, 15),
    true
);
check(
    'the offseason never polls, even if a week number matches',
    isViewingLiveWeek({ season_type: 'off', display_week: 1 }, 1),
    false
);
check(
    'no NFL state at all -> does not poll',
    isViewingLiveWeek(null, 5),
    false
);
check(
    'a string week still compares correctly against a numeric live week',
    isViewingLiveWeek({ season_type: 'regular', display_week: 5 }, '5'),
    true
);
check(
    'falls back to week when display_week is absent',
    isViewingLiveWeek({ season_type: 'regular', week: 7 }, 7),
    true
);
check(
    'a null viewed week never polls',
    isViewingLiveWeek({ season_type: 'regular', display_week: 5 }, null),
    false
);
check(
    'the poll interval is a sane, non-zero cadence',
    LIVE_SCORE_POLL_MS > 0 && LIVE_SCORE_POLL_MS <= 60000,
    true
);

// --- formatKickoffTime -- deliberately not asserting an exact clock string,
// since that's a function of whichever timezone this happens to run in
// (CI vs. a laptop). Checked structurally instead: never a fabricated value
// for bad input, and derived from the real Date parse rather than a stub.
check('no timestamp at all -> null', formatKickoffTime(null), null);
check('an unparseable string -> null', formatKickoffTime('not-a-date'), null);
check('an empty string -> null', formatKickoffTime(''), null);

const kickoff = formatKickoffTime('2026-09-14T17:00:00Z');
check('a valid ISO timestamp produces a non-empty local time string', typeof kickoff === 'string' && kickoff.length > 0, true);
check(
    'the formatted time matches a direct toLocaleTimeString call on the same instant (same options, whatever the local timezone is)',
    kickoff,
    new Date('2026-09-14T17:00:00Z').toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
);
check(
    'two different kickoff times format to two different strings, not a hardcoded constant',
    formatKickoffTime('2026-09-14T17:00:00Z') !== formatKickoffTime('2026-09-15T01:00:00Z'),
    true
);

console.log(`OK: ${checks} live-score checks passed`);
