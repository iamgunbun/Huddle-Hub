// Working out which member of a league is the connected account.
//
// Kept dependency-free so the matching is directly testable. Yahoo's equivalent
// lives in yahooHistory.js (parseYahooOwnTeams) because Yahoo answers it
// outright -- it returns the login's own team, flagged. Sleeper has no such
// endpoint: /league/{id}/users returns every member equally, so identifying the
// account means matching on something we stored.

const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Sleeper marks the commissioner as the league's owner. */
export const isSleeperCommissioner = (user) => user?.is_owner === true;

/**
 * Finds the connected account among a Sleeper league's members.
 *
 * A Sleeper user id is exact and always preferred. Falling back to a stored
 * team name is a heuristic -- two members can share a display name, and a
 * member can rename their team -- so a name match only counts when it is
 * unambiguous. An ambiguous or absent match returns null rather than a guess,
 * because the caller uses this to decide who gets commissioner tools.
 */
export const findSleeperLeagueUser = (users, { userId = null, teamName = null } = {}) => {
    if (!Array.isArray(users) || !users.length) return null;

    if (userId) {
        const byId = users.find(u => u && String(u.user_id) === String(userId));
        if (byId) return byId;
    }

    const wanted = normalize(teamName);
    if (!wanted) return null;

    const matches = users.filter(u => u && [u.display_name, u.user_name, u.metadata?.team_name]
        .some(name => normalize(name) === wanted));

    return matches.length === 1 ? matches[0] : null;
};
