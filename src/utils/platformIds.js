// Telling Sleeper, Yahoo, and ESPN league ids apart.
//
// Yahoo ids are self-describing: they always look like "461.l.123456" (a dot,
// never present in a Sleeper id). ESPN ids are NOT self-describing -- ESPN
// league ids are plain numbers, exactly the same shape Sleeper uses. Every
// routing check in this app used to be "does it look like Yahoo? If not,
// assume Sleeper" -- which was silently true before ESPN existed, and is
// actively wrong now: a bare numeric id could be a real ESPN league that
// happens to collide with an unrelated real Sleeper league's id, and would
// get that Sleeper league's data displayed with no indication anything was
// wrong.
//
// Since ESPN's own id can't be told apart from Sleeper's by shape, it's
// disambiguated in-app with a prefix ("espn:1234567") everywhere the id is
// threaded through the UI and its helper functions. The prefix is stripped
// again at the one boundary that actually calls ESPN's API with it -- ESPN
// itself has never heard of this prefix and only wants the bare number.
export const ESPN_ID_PREFIX = 'espn:';

export const isYahooLeagueId = (id) =>
    !!id && (String(id).includes('.') || !/^\d+$/.test(String(id).replace(ESPN_ID_PREFIX, '')));

export const isEspnLeagueId = (id) => typeof id === 'string' && id.startsWith(ESPN_ID_PREFIX);

export const toEspnLeagueId = (rawId) => `${ESPN_ID_PREFIX}${String(rawId ?? '').trim()}`;

// The bare numeric id ESPN's own API actually wants. Safe to call on a
// not-yet-prefixed value too, so a caller never has to check first.
export const fromEspnLeagueId = (id) => String(id ?? '').replace(ESPN_ID_PREFIX, '');

/**
 * One place to answer "which platform is this league on", instead of each
 * caller re-deriving it (and, before this existed, several of them getting
 * ESPN wrong by leaving it out entirely). Order matters: Yahoo's shape check
 * must run before Sleeper's fallback, and ESPN's explicit prefix must be
 * checked before falling through to "must be Sleeper".
 */
export const detectPlatform = (id) => {
    if (isEspnLeagueId(id)) return 'espn';
    if (isYahooLeagueId(id)) return 'yahoo';
    return 'sleeper';
};
