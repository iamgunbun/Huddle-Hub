// Working out whether a league is Redraft, Keeper, or Dynasty.
//
// Sleeper says so directly: `settings.type` is 0 (redraft), 1 (keeper), or 2
// (dynasty). Trust it outright there -- no inference needed.
//
// Yahoo publishes no equivalent field. The league object Yahoo returns has no
// "type" of this kind at all, so any code that read one from a Yahoo league's
// `settings.type` was reading a value this app fabricated as a Sleeper-shaped
// placeholder, not something Yahoo said. The signal that *is* actually
// available: how many players carried over from last season's roster to this
// one. A redraft league starts every roster from zero; a keeper league
// carries over a small, commissioner-capped handful; a dynasty league keeps
// most of the roster year over year.

export const sleeperLeagueFormat = (settingsType) => {
    const type = Number(settingsType);
    if (type === 2) return 'dynasty';
    if (type === 1) return 'keeper';
    return 'redraft';
};

// Most keeper leagues cap keepers somewhere in the 1-5 range; a dynasty
// league's roster is mostly held, season to season, well past that.
export const KEEPER_MAX_CARRYOVER = 5;

/**
 * Classifies one roster's year-over-year carryover.
 * `currentIds`/`priorIds` are that roster's player ids in each season.
 * Returns `format: null` when there's nothing to compare (no prior season,
 * or an empty one) -- an unknown answer, not a guessed one.
 */
export const estimateFormatFromCarryover = (currentIds, priorIds) => {
    if (!Array.isArray(currentIds) || !Array.isArray(priorIds) || !priorIds.length) {
        return { format: null, carried: 0, priorSize: priorIds?.length || 0 };
    }

    const priorSet = new Set(priorIds.map(String));
    const carried = currentIds.map(String).filter(id => priorSet.has(id)).length;

    let format;
    if (carried === 0) format = 'redraft';
    else if (carried <= KEEPER_MAX_CARRYOVER) format = 'keeper';
    else format = 'dynasty';

    return { format, carried, priorSize: priorIds.length };
};

/**
 * The same question asked of a whole league rather than one roster.
 *
 * `currentRosters`/`priorRosters` are arrays of `{ owner_id, co_owners,
 * players }`. Rosters are matched across seasons by manager identity (owner
 * id or a co-owner), not by roster/team id -- team ids can be reassigned
 * between seasons (a team drops out, slots shuffle) while manager identity is
 * the one thing that stays stable across a renew chain.
 *
 * The league's answer is the MEDIAN team's carryover, not any single team's:
 * one dynasty stash-and-hold team in an otherwise-redraft league shouldn't
 * flip the whole league's label, and one team that churned its entire roster
 * in an otherwise-keeper league shouldn't hide it either.
 */
export const estimateLeagueFormatFromRosterSets = (currentRosters, priorRosters) => {
    if (!Array.isArray(priorRosters) || !priorRosters.length || !Array.isArray(currentRosters)) {
        return { format: null, sampleSize: 0, median: 0 };
    }

    const priorByOwner = new Map();
    priorRosters.forEach(r => {
        const owners = [r?.owner_id, ...(r?.co_owners || [])].filter(Boolean).map(String);
        owners.forEach(o => { if (!priorByOwner.has(o)) priorByOwner.set(o, r.players || []); });
    });

    const carriedCounts = [];
    currentRosters.forEach(r => {
        const owners = [r?.owner_id, ...(r?.co_owners || [])].filter(Boolean).map(String);
        const matchedOwner = owners.find(o => priorByOwner.has(o));
        if (matchedOwner === undefined) return;
        const { carried } = estimateFormatFromCarryover(r.players, priorByOwner.get(matchedOwner));
        carriedCounts.push(carried);
    });

    if (!carriedCounts.length) return { format: null, sampleSize: 0, median: 0 };

    const sorted = [...carriedCounts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    let format;
    if (median === 0) format = 'redraft';
    else if (median <= KEEPER_MAX_CARRYOVER) format = 'keeper';
    else format = 'dynasty';

    return { format, sampleSize: carriedCounts.length, median };
};

export const formatLabel = (format) => {
    if (format === 'dynasty') return 'Dynasty';
    if (format === 'keeper') return 'Keeper';
    return 'Redraft';
};
