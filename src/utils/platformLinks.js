// Where a connected league lives on the platform it came from.
//
// Kept dependency-free (and separate from universalFunctions, which pulls in
// half the app) so the id handling is directly testable -- the ids are the part
// that bites: a Yahoo league key is "<game_key>.l.<league_id>" while Yahoo's own
// URLs use the bare league id, and a stored key may be the "nfl.l.<id>" alias
// instead of a season-specific one.

const isYahooLeague = (league) => {
    if (league?.platform === 'yahoo') return true;
    const id = league?.sleeper_league_id;
    return !!id && (String(id).includes('.') || !/^\d+$/.test(String(id)));
};

/** The label and destination for the "open this league on its platform" link. */
export const getPlatformLink = (league) => {
    const externalId = String(league?.sleeper_league_id || '');

    if (isYahooLeague(league)) {
        // Both "470.l.604026" and the "nfl.l.604026" alias carry the same
        // league id, and that's all Yahoo's URLs want. On a phone the https
        // link hands off to the Yahoo Fantasy app.
        const leagueId = externalId.split('.l.').pop();
        return {
            platform: 'yahoo',
            label: 'Go to Yahoo',
            url: leagueId
                ? `https://football.fantasysports.yahoo.com/f1/${leagueId}`
                : 'https://football.fantasysports.yahoo.com/',
        };
    }

    return {
        platform: 'sleeper',
        label: 'Go to Sleeper',
        url: `https://sleeper.app/leagues/${externalId}`,
    };
};
