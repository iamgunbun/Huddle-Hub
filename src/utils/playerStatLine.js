// The id split PlayerModal (and a few other pages) needs to query Sleeper's
// own per-player endpoints (stats, projections, sleepercdn images).
//
// In a Yahoo league the shared player dictionary is deliberately keyed by
// Yahoo's own player id wherever the crosswalk knows one (so a Yahoo roster's
// player ids can be looked up directly) -- see src/utils/helperFunctions/
// players.js. That means `.id`/`.player_id` on a dictionary entry can be a
// YAHOO id, which a Sleeper-hosted endpoint doesn't recognise: it doesn't
// error, it just returns nothing (or, worse, a coincidentally-valid but wrong
// player). `.sleeper_id` is set on every dictionary entry regardless of
// platform and is always the real Sleeper id -- the only one safe to send to
// a Sleeper endpoint.
export const resolveSleeperStatsId = (player) => player?.sleeper_id || player?.player_id || null;

/**
 * Builds the position-appropriate projected stat line for one week's
 * projection object, from the same `statGroups` shape the game-log/season
 * tables already use ({ name, cols: [{ label, key }] }).
 *
 * Only categories that are genuinely present as numbers are returned -- an
 * empty or all-missing projection produces an empty stat line rather than a
 * row of fabricated zeros.
 */
export const buildProjectedStatLine = (statGroups, projStats) => {
    const stats = projStats || {};
    const cols = [];

    (statGroups || []).forEach(group => {
        (group.cols || []).forEach(col => {
            const val = stats[col.key];
            if (typeof val === 'number') {
                cols.push({ key: `${group.name}-${col.label}`, label: `${group.name} ${col.label}`, val });
            }
        });
    });

    return cols;
};
