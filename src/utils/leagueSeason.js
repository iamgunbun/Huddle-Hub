// Following a Sleeper league forward into the current season.
//
// Sleeper mints a NEW league id every season and freezes the old one in place,
// linked only backwards via previous_league_id. The id captured when a league
// was first connected therefore goes stale the moment the league rolls over --
// and the stale league still answers /rosters perfectly happily, with last
// season's rosters. Nothing looks broken; the data is simply a year out, which
// makes currently-rostered players look available and dropped players look
// owned. Dynasty leagues show it worst, since that's where rosters carry over
// and the drift is all trades and rookie picks.
//
// There's no "next league" pointer, so the successor is found by asking one of
// the league's own members what leagues they're in this season, then matching
// on the backwards link.

/**
 * Given this season's leagues for a member, find the one descended from
 * `staleLeagueId`. Follows the chain in case more than one season elapsed.
 */
export const findSuccessorLeagueId = (candidateLeagues, staleLeagueId) => {
    if (!Array.isArray(candidateLeagues) || !staleLeagueId) return null;

    const stale = String(staleLeagueId);

    // Follow the "descended from" links forward as far as they go, so a league
    // left alone for more than one season lands on the newest id rather than an
    // intermediate season's.
    const byPrevious = new Map();
    candidateLeagues.forEach(l => {
        if (l?.league_id && l.previous_league_id) byPrevious.set(String(l.previous_league_id), String(l.league_id));
    });

    let cursor = stale;
    let newest = null;
    const seen = new Set([stale]);
    while (byPrevious.has(cursor)) {
        const next = byPrevious.get(cursor);
        if (seen.has(next)) break; // defensive: never loop on malformed data
        seen.add(next);
        newest = next;
        cursor = next;
    }
    if (newest) return newest;

    // The stored id may already be current -- nothing to do.
    if (candidateLeagues.some(l => l && String(l.league_id) === stale)) return null;

    // Otherwise walk each candidate's ancestry, in case the intervening seasons
    // aren't present in this season's list at all.
    const byId = new Map(candidateLeagues.filter(l => l?.league_id).map(l => [String(l.league_id), l]));
    for (const candidate of byId.values()) {
        let node = candidate;
        const walked = new Set();
        while (node?.previous_league_id && !walked.has(String(node.previous_league_id))) {
            const prev = String(node.previous_league_id);
            if (prev === stale) return String(candidate.league_id);
            walked.add(prev);
            node = byId.get(prev);
        }
    }

    return null;
};

/** Any Sleeper user id we can find on the league's rosters. */
export const pickOwnerId = (rosters) => {
    if (!rosters || typeof rosters !== 'object') return null;
    for (const roster of Object.values(rosters)) {
        if (roster?.owner_id) return String(roster.owner_id);
    }
    return null;
};

/**
 * Resolves a possibly-stale Sleeper league id to the current season's id.
 * Returns null when it's already current, or when the successor can't be found
 * (in which case the caller should keep using what it has rather than break).
 */
export const resolveCurrentSeasonLeagueId = async ({ storedLeagueId, leagueSeason, currentSeason, rosters }) => {
    if (!storedLeagueId || !leagueSeason || !currentSeason) return null;
    if (String(leagueSeason) === String(currentSeason)) return null;

    const ownerId = pickOwnerId(rosters);
    if (!ownerId) return null;

    try {
        const res = await fetch(`https://api.sleeper.app/v1/user/${ownerId}/leagues/nfl/${currentSeason}`);
        if (!res.ok) return null;
        const leagues = await res.json();
        return findSuccessorLeagueId(leagues, storedLeagueId);
    } catch (err) {
        console.warn("Could not resolve the current-season league id:", err);
        return null;
    }
};
