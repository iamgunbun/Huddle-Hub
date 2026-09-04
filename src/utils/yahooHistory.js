// Reading a Yahoo league's HISTORY out of the shapes Yahoo actually returns.
//
// Everything here is pure: it takes a parsed Yahoo JSON payload and returns
// plain objects. The network side lives in yahooService.js. Keeping the parsing
// separate is deliberate -- Yahoo's response shapes are the fiddly part (see
// below) and this environment can't reach Yahoo to try things out, so the
// parsing has to be exercised by tests instead.
//
// Three shape quirks drive nearly all of the code below:
//
//  1. A "collection" (teams, matchups, players) is sometimes a real array and
//     sometimes an object keyed "0", "1", "2", ... with an extra `count` key.
//  2. An "entity" (a team, a player) is an ARRAY of single-key objects rather
//     than one object -- so a field is found by scanning, not by lookup.
//  3. A node that carries both sub-collections and scalars puts the collection
//     under a numeric key: `matchup: { "0": { teams: ... }, week: "3", ... }`.

/** Values of a Yahoo collection, whether it arrived as an array or as an object. */
export const yahooCollection = (node) => {
    if (!node) return [];
    if (Array.isArray(node)) return node.filter(Boolean);
    if (typeof node !== 'object') return [];
    return Object.keys(node)
        .filter(k => k !== 'count')
        .map(k => node[k])
        .filter(Boolean);
};

/** Pulls one field out of Yahoo's array-of-single-key-objects entity form. */
export const yahooField = (entity, field) => {
    if (!entity) return undefined;
    if (Array.isArray(entity)) {
        const hit = entity.find(x => x && typeof x === 'object' && x[field] !== undefined);
        return hit ? hit[field] : undefined;
    }
    if (typeof entity === 'object') return entity[field];
    return undefined;
};

/** Finds a named sub-node among the values of a wrapper object/array. */
const findNode = (node, key) => {
    for (const value of yahooCollection(node)) {
        if (value && typeof value === 'object' && value[key] !== undefined) return value[key];
    }
    return null;
};

const num = (value, fallback = 0) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
};

// --------------------------------------------------------------------------
// Standings
// --------------------------------------------------------------------------

/**
 * Every team in a league season, with its final (or current) standing.
 *
 * `rank` is the load-bearing field for the trophy room: once a Yahoo season is
 * finished, the standings rank already reflects the playoff result -- rank 1 is
 * the champion. Yahoo exposes no bracket endpoint, so this is the only place
 * the champion is stated outright.
 *
 * `managerGuids` matters just as much and is easy to miss: a team_key
 * ("461.l.123.t.5") is scoped to ONE season, so using it as a manager's
 * identity makes the same person look like a different manager every year and
 * all-time records never accumulate. The manager guid is stable across seasons.
 */
export const parseYahooStandings = (data) => {
    const league = data?.fantasy_content?.league;
    const standings = findNode(league, 'standings');
    const teamsNode = findNode(standings, 'teams') || standings?.[0]?.teams;
    const rows = [];

    yahooCollection(teamsNode).forEach(entry => {
        const team = entry?.team;
        if (!team) return;

        const info = Array.isArray(team) ? team[0] : team;
        const teamKey = yahooField(info, 'team_key');
        const teamId = parseInt(yahooField(info, 'team_id'));
        if (!teamKey && !Number.isFinite(teamId)) return;

        const standingsNode = Array.isArray(team)
            ? team.find(x => x && x.team_standings)?.team_standings
            : team.team_standings;
        const totals = standingsNode?.outcome_totals || {};

        const logos = yahooField(info, 'team_logos');
        const logoUrl = yahooCollection(logos)[0]?.team_logo?.url;

        const managers = yahooCollection(yahooField(info, 'managers'))
            .map(m => m?.manager)
            .filter(Boolean);

        rows.push({
            rosterId: Number.isFinite(teamId) ? teamId : null,
            teamKey: teamKey || null,
            teamName: yahooField(info, 'name') || (Number.isFinite(teamId) ? `Team ${teamId}` : 'Team'),
            logoUrl: logoUrl || null,
            // guid is Yahoo's stable per-user id; nickname is only a display name.
            managerGuids: managers.map(m => m.guid).filter(Boolean),
            managerName: managers[0]?.nickname || null,
            isOwnedByCurrentLogin: Number(yahooField(info, 'is_owned_by_current_login')) === 1,
            rank: standingsNode?.rank !== undefined ? parseInt(standingsNode.rank) : null,
            playoffSeed: standingsNode?.playoff_seed !== undefined ? parseInt(standingsNode.playoff_seed) : null,
            wins: parseInt(totals.wins) || 0,
            losses: parseInt(totals.losses) || 0,
            ties: parseInt(totals.ties) || 0,
            pointsFor: num(standingsNode?.points_for),
            pointsAgainst: num(standingsNode?.points_against),
            streak: standingsNode?.streak?.value ?? 0,
            divisionId: yahooField(info, 'division_id') !== undefined
                ? parseInt(yahooField(info, 'division_id'))
                : null,
        });
    });

    return rows;
};

/**
 * The season's podium, derived from final standings.
 *
 * Sleeper hands over an explicit playoff bracket; Yahoo does not, so the finish
 * order is read off the completed season's ranks instead. Only call this for a
 * season Yahoo reports as finished -- mid-season ranks are just the current
 * standings and would crown a champion in October.
 *
 * `toilet` is last place rather than the winner of a toilet bowl. Yahoo's
 * consolation ladder doesn't map cleanly onto Sleeper's losers bracket, and
 * last place is the finish every league agrees on.
 */
export const buildPodiumFromStandings = (rows, year) => {
    const ranked = (rows || [])
        .filter(r => r && Number.isFinite(r.rank) && r.rosterId !== null && r.rosterId !== undefined)
        .sort((a, b) => a.rank - b.rank);

    if (!ranked.length) return null;

    const at = (i) => (ranked[i] ? ranked[i].rosterId : undefined);
    const champion = at(0);
    if (champion === undefined) return null;

    return {
        year,
        champion,
        second: at(1),
        third: at(2),
        toilet: ranked.length > 3 ? ranked[ranked.length - 1].rosterId : undefined,
        // Yahoo divisions are optional and most leagues run without them; an
        // empty list renders as "no divisions" rather than a wrong one.
        divisions: buildDivisionWinners(ranked),
    };
};

const buildDivisionWinners = (ranked) => {
    const withDivision = ranked.filter(r => Number.isFinite(r.divisionId));
    if (!withDivision.length) return [];

    const best = new Map();
    withDivision.forEach(r => {
        const current = best.get(r.divisionId);
        // Already rank-sorted, so the first team seen in a division won it.
        if (!current) best.set(r.divisionId, { name: `Division ${r.divisionId}`, rosterID: r.rosterId, wins: r.wins, points: r.pointsFor });
    });
    return [...best.values()];
};

// --------------------------------------------------------------------------
// Scoreboard / matchups
// --------------------------------------------------------------------------

/**
 * Flattens a scoreboard response into one row per matchup.
 *
 * Handles a multi-week request (`scoreboard;week=1,2,3`) as well as a single
 * week: every matchup carries its own `week`, so the two cases parse the same.
 * Asking for several weeks at once is what keeps a multi-season history walk
 * from firing dozens of proxy calls -- bursts of those were what produced the
 * intermittent 400s from Yahoo.
 */
export const parseYahooScoreboard = (data, fallbackWeek = null) => {
    const league = data?.fantasy_content?.league;
    const scoreboard = findNode(league, 'scoreboard');
    if (!scoreboard) return [];

    const matchupsNode = findNode(scoreboard, 'matchups')
        || scoreboard?.matchups
        || scoreboard?.[0]?.matchups;

    const results = [];

    yahooCollection(matchupsNode).forEach(entry => {
        const matchup = entry?.matchup;
        if (!matchup) return;

        const teamsNode = findNode(matchup, 'teams') || matchup?.[0]?.teams;
        const teams = [];

        yahooCollection(teamsNode).forEach(teamEntry => {
            const team = teamEntry?.team;
            if (!team) return;
            const info = Array.isArray(team) ? team[0] : team;
            const pointsNode = Array.isArray(team)
                ? team.find(x => x && x.team_points)?.team_points
                : team.team_points;

            const rosterId = parseInt(yahooField(info, 'team_id'));
            if (!Number.isFinite(rosterId)) return;

            teams.push({
                roster_id: rosterId,
                team_key: yahooField(info, 'team_key') || null,
                points: num(pointsNode?.total),
                starters: [],
                starters_points: [],
            });
        });

        // A matchup Yahoo describes with fewer than two identifiable teams can't
        // be scored against a roster, and silently dropping it would just make
        // a week's records quietly incomplete.
        if (teams.length < 2) {
            console.warn('Yahoo scoreboard: skipping a matchup with no identifiable teams.', matchup);
            return;
        }

        const week = parseInt(matchup.week ?? fallbackWeek);
        const status = matchup.status || null;

        results.push({
            week: Number.isFinite(week) ? week : null,
            status,
            // "postevent" is Yahoo saying the games are final. Without a status
            // an unplayed week still returns a matchup with 0-0, which would
            // otherwise be recorded as a real result and poison the
            // lowest-score records.
            played: status ? status === 'postevent' : teams.some(t => t.points > 0),
            isPlayoffs: Number(matchup.is_playoffs) === 1,
            isConsolation: Number(matchup.is_consolation) === 1,
            winnerTeamKey: matchup.winner_team_key || null,
            teams,
        });
    });

    return results;
};

/**
 * Groups played playoff matchups into rounds, in the order they were played.
 *
 * Championship and consolation games in the same week are kept apart because
 * the records engine labels them differently ("Finals" vs "(C) Week 16").
 */
export const groupPlayoffRounds = (matchups) => {
    const playoff = (matchups || []).filter(m => m && m.isPlayoffs && m.played);
    if (!playoff.length) return [];

    const byKey = new Map();
    playoff.forEach(m => {
        const key = `${m.week}|${m.isConsolation ? 'c' : 'p'}`;
        if (!byKey.has(key)) byKey.set(key, { week: m.week, consolation: m.isConsolation, matchups: [] });
        byKey.get(key).matchups.push(m);
    });

    const groups = [...byKey.values()].sort((a, b) => (a.week - b.week) || (a.consolation === b.consolation ? 0 : a.consolation ? 1 : -1));

    // Round numbering counts championship weeks only, so "Finals" lands on the
    // last championship week even when a consolation game shares that week.
    const championshipWeeks = [...new Set(groups.filter(g => !g.consolation).map(g => g.week))].sort((a, b) => a - b);

    return groups.map(group => ({
        ...group,
        roundIndex: championshipWeeks.indexOf(group.week),
        totalRounds: championshipWeeks.length,
    }));
};
