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
//
// ESPN keeps ONE league id for the league's entire lifetime (unlike
// Sleeper/Yahoo, which mint a new id every season) -- a past season is a
// different `year` query against the SAME id, not a different id. To let
// every existing "walk previous_league_id" loop in the app traverse an ESPN
// league's history the same way it already does for Sleeper/Yahoo, a past
// season is encoded as a second, season-qualified form of this same prefix:
// "espn:1234567:2024". The live/current-season id ("espn:1234567", no year)
// is left alone everywhere else in the app.
export const ESPN_ID_PREFIX = 'espn:';

export const isEspnLeagueId = (id) => typeof id === 'string' && id.startsWith(ESPN_ID_PREFIX);

// Checked (and excluded) before the Yahoo shape test below -- a season-
// qualified ESPN id ("espn:123:2024") contains a colon, which is neither a
// dot nor all-digits, and would otherwise misread as Yahoo-shaped.
export const isYahooLeagueId = (id) => {
    if (!id || isEspnLeagueId(id)) return false;
    const str = String(id);
    return str.includes('.') || !/^\d+$/.test(str);
};

export const toEspnLeagueId = (rawId) => `${ESPN_ID_PREFIX}${String(rawId ?? '').trim()}`;

// A specific past season of an ESPN league -- used only for
// `previous_league_id` pointers built while walking a league's history.
export const toEspnSeasonLeagueId = (rawId, year) => `${ESPN_ID_PREFIX}${String(rawId ?? '').trim()}:${year}`;

// Splits either form into the bare numeric id ESPN's API wants and the
// season it names (null for the current-season form, meaning "whatever
// season is live right now"). Safe to call on a not-yet-prefixed value too.
export const parseEspnLeagueId = (id) => {
    const stripped = String(id ?? '').replace(ESPN_ID_PREFIX, '');
    const [leagueId, year] = stripped.split(':');
    return { leagueId, year: year ? parseInt(year) : null };
};

// The bare numeric id ESPN's own API actually wants. Safe to call on a
// not-yet-prefixed value, or a season-qualified one, too.
export const fromEspnLeagueId = (id) => parseEspnLeagueId(id).leagueId;

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
