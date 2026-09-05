import assert from 'node:assert/strict';
import { isViewingLiveWeek, LIVE_SCORE_POLL_MS } from '../src/utils/liveScores.js';

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

console.log(`OK: ${checks} live-score checks passed`);
