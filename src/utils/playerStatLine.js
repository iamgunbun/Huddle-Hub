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

/**
 * A short, single-line summary of a player's REAL stat line for the week so
 * far -- "18/25, 245 YD, 2 TD" for a QB, "12 CAR, 68 YD, 1 TD" for a rusher
 * -- built from the same raw category keys Sleeper's stats feed already
 * uses (weeklyStats in Matchups.jsx/Rosters.jsx). A stat group (passing,
 * rushing, receiving, ...) is only included once the player has a genuine
 * non-zero count in it -- a QB who hasn't been sacked into negative rushing
 * yards yet doesn't need a "0 CAR, 0 YD" line, and this is meant to sit
 * quietly at the bottom of a compact tile, not list every category a
 * position could theoretically produce. Returns null (never a fabricated
 * placeholder) once there is nothing real to show yet.
 */
export const buildLiveStatLine = (pos, rawStats) => {
    if (!rawStats) return null;
    const s = rawStats.stats || rawStats;
    const num = (key) => (typeof s[key] === 'number' ? s[key] : null);
    const parts = [];

    if (pos === 'QB') {
        const att = num('pass_att');
        const cmp = num('pass_cmp');
        if (att || cmp) {
            parts.push(`${cmp || 0}/${att || 0}`, `${num('pass_yd') || 0} YD`);
            if (num('pass_td')) parts.push(`${num('pass_td')} TD`);
            if (num('pass_int')) parts.push(`${num('pass_int')} INT`);
        }
        const rushAtt = num('rush_att');
        if (rushAtt) {
            parts.push(`${num('rush_yd') || 0} RUSH YD`);
            if (num('rush_td')) parts.push(`${num('rush_td')} RUSH TD`);
        }
    } else if (pos === 'RB' || pos === 'WR' || pos === 'TE') {
        const car = num('rush_att');
        if (car) {
            parts.push(`${car} CAR`, `${num('rush_yd') || 0} YD`);
            if (num('rush_td')) parts.push(`${num('rush_td')} TD`);
        }
        const rec = num('rec');
        if (rec) {
            parts.push(`${rec} REC`, `${num('rec_yd') || 0} YD`);
            if (num('rec_td')) parts.push(`${num('rec_td')} TD`);
        }
    } else if (pos === 'K') {
        const fga = num('fga');
        const fgm = num('fgm');
        if (fga || fgm) parts.push(`${fgm || 0}/${fga || 0} FG`);
        const xpa = num('xpa');
        const xpm = num('xpm');
        if (xpa || xpm) parts.push(`${xpm || 0}/${xpa || 0} XP`);
    } else if (pos === 'DEF') {
        if (num('sack')) parts.push(`${num('sack')} SACK`);
        if (num('int')) parts.push(`${num('int')} INT`);
        if (num('fum_rec')) parts.push(`${num('fum_rec')} FR`);
        if (num('ff')) parts.push(`${num('ff')} FF`);
        if (num('def_td')) parts.push(`${num('def_td')} TD`);
        if (Number.isFinite(num('pts_allow'))) parts.push(`${num('pts_allow')} PA`);
    }

    return parts.length ? parts.join(', ') : null;
};
