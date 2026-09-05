// How far a team has moved in the power rankings.
//
// A ranking with no history is just a list; the movement is what makes it read
// as a story. There's nowhere to get last week's order from a platform, so the
// app has to remember its own -- one snapshot of the order per week, kept per
// league.
//
// Pure, so the fiddly cases have somewhere to be pinned down: a team that
// wasn't ranked last week hasn't "moved", and re-rendering the same week must
// not compare a week against itself and report everyone as static when they
// actually moved since the last completed week.

/**
 * Movement for each team, against the most recent snapshot from an EARLIER week.
 *
 * @param {Array} currentOrder roster ids, best first
 * @param {Object} snapshots   { [week]: rosterId[] }
 * @param {number} currentWeek
 * @returns {Map} rosterId -> movement (positive = moved up), or null if new
 */
export const movementFromSnapshots = (currentOrder, snapshots, currentWeek) => {
    const movement = new Map();
    const order = currentOrder || [];

    const previousWeek = Object.keys(snapshots || {})
        .map(Number)
        .filter(w => Number.isFinite(w) && w < currentWeek)
        .sort((a, b) => b - a)[0];

    // No earlier week to compare against: everyone is new, nobody has "moved".
    if (previousWeek === undefined) {
        order.forEach(id => movement.set(id, null));
        return movement;
    }

    const previousOrder = (snapshots[previousWeek] || []).map(String);
    order.forEach((id, index) => {
        const wasAt = previousOrder.indexOf(String(id));
        // A team absent last week (new manager, or the first ranked week) has no
        // movement rather than a movement of zero -- those read differently.
        movement.set(id, wasAt === -1 ? null : wasAt - index);
    });
    return movement;
};

/** Records this week's order, keeping only recent weeks so the entry stays small. */
export const withSnapshot = (snapshots, currentWeek, order, keepWeeks = 6) => {
    const next = { ...(snapshots || {}), [currentWeek]: (order || []).map(String) };
    const weeks = Object.keys(next).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
    const kept = {};
    weeks.slice(0, keepWeeks).forEach(w => { kept[w] = next[w]; });
    return kept;
};
