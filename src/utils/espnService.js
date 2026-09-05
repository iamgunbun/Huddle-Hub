// src/utils/espnService.js
import { supabase } from '../supabaseClient';
import { fromEspnLeagueId, parseEspnLeagueId, toEspnSeasonLeagueId } from './platformIds';
import {
    parseEspnLeagueRosters,
    parseEspnSchedule,
    parseEspnTransactions,
    parseEspnDraftDetail,
    findPriorEspnSeason,
    isEspnSeasonComplete,
} from './espnParsers';

// Most callers (every page's own `getLeagueData(id)`, with no explicit user)
// never pass a userId at all -- they're relying on this resolving the current
// session itself, the same fallback yahooService.js uses for the same reason.
// Without it, a private ESPN league's stored cookies would never actually get
// looked up from any of those call sites.
const getUserId = async (explicitUserId) => {
    if (explicitUserId) return explicitUserId;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
};

// A single call to this app's own proxy, which fetches
// lm-api-reads.fantasy.espn.com with whatever `views` (and, for a specific
// week's box score, `scoringPeriodId`) are asked for and this account's
// stored cookies attached server-side. `explicitCookies` is only used by the
// "try connecting" preview on the Add League page, before anything is saved.
//
// The season queried is whichever of these is present, in order: an explicit
// `year` option, the season encoded in a season-qualified id
// ("espn:123:2024" -- see platformIds.js), or the current year. A caller
// walking a league's history never has to pass `year` itself -- it's carried
// by the id its own previous_league_id chain produces.
const espnProxyRequest = async (leagueId, { views, scoringPeriodId, year } = {}, userId = null, explicitCookies = {}) => {
    const { leagueId: cleanId, year: idYear } = parseEspnLeagueId(leagueId);
    if (!cleanId) return null;
    const resolvedUserId = await getUserId(userId);

    const response = await fetch('/api/espn-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            leagueId: cleanId,
            year: year || idYear || new Date().getFullYear(),
            views,
            scoringPeriodId,
            espnS2: explicitCookies?.espn_s2,
            swid: explicitCookies?.swid,
            userId: resolvedUserId,
        }),
    });

    if (response.status === 401) {
        throw new Error("Private ESPN League: Please provide valid espn_s2 and SWID cookies.");
    }
    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${response.status}`);
    }
    return response.json();
};

// `leagueId` may be the app's own disambiguated "espn:1234567" form (see
// platformIds.js) or the bare ESPN id -- ESPN itself has never heard of the
// prefix and only wants the number, so it's stripped here rather than at
// every call site.
//
// `cookies` are only needed for a league this account hasn't connected yet
// (the "try connecting" preview on the Add League page, before anything is
// saved). Once connected, `userId` alone is enough -- the proxy looks up
// this account's stored ESPN cookies itself, the same way the Yahoo proxy
// looks up its stored OAuth token.
export const fetchAndNormalizeESPNLeague = async (leagueId, cookies = {}, userId = null) => {
    if (!leagueId) return null;
    const cleanId = fromEspnLeagueId(leagueId).trim();

    try {
        const data = await espnProxyRequest(
            leagueId,
            { views: ['mSettings', 'mTeam'] },
            userId,
            cookies
        );

        if (!data || !data.settings) {
            throw new Error("Invalid ESPN league data returned.");
        }

        // --- NORMALIZE ESPN JSON TO SLEEPER FORMAT ---
        const leagueName = data.settings.name || `ESPN League ${cleanId}`;
        const totalRosters = data.settings.size || (data.teams ? data.teams.length : 10);

        // Detect keeper/dynasty vs redraft
        const keeperCount = data.settings.draftSettings?.keeperCount || 0;
        const leagueType = keeperCount > 5 ? 2 : (keeperCount > 0 ? 1 : 0);

        // Fallback league avatar
        const firstTeamWithLogo = data.teams?.find(t => t.logo);
        const avatar = firstTeamWithLogo?.logo || '/brand.png';

        const playoffWeekStart = (data.settings.scheduleSettings?.matchupPeriodCount || 14) + 1;
        const isAuctionDraft = String(data.settings.draftSettings?.type || '').toUpperCase() === 'OFFLINE'
            ? false
            : String(data.settings.draftSettings?.type || '').toUpperCase() === 'AUCTION';

        const seasonId = parseInt(data.seasonId) || new Date().getFullYear();

        const priorYear = findPriorEspnSeason(data.status?.previousSeasons, seasonId);
        const previousLeagueId = priorYear !== null ? toEspnSeasonLeagueId(cleanId, priorYear) : null;

        const seasonComplete = isEspnSeasonComplete({
            seasonId,
            currentMatchupPeriod: data.status?.currentMatchupPeriod,
            matchupPeriodCount: data.settings.scheduleSettings?.matchupPeriodCount,
        });

        return {
            // `id`/`sleeper_league_id` are deliberately the BARE id, not the
            // espn:-prefixed one -- LeagueContext overwrites sleeper_league_id
            // with the prefixed form once this flows into a connected league
            // record. `league_id` is deliberately left unset: leagueAwards.js
            // reads `leagueData.league_id || queryLeagueID` to decide which id
            // to route further calls through, and depends on it being absent
            // here so that falls back to the caller's already-prefixed id
            // instead of this bare one.
            id: String(cleanId),
            sleeper_league_id: String(cleanId),
            previous_league_id: previousLeagueId,
            name: leagueName,
            season: String(seasonId),
            status: seasonComplete ? 'complete' : 'in_season',
            platform: 'espn',
            total_rosters: totalRosters,
            settings: {
                type: leagueType,
                playoff_week_start: playoffWeekStart,
                is_auction_draft: isAuctionDraft,
                divisions: (data.settings.scheduleSettings?.divisions || []).length,
                playoff_teams: data.settings.scheduleSettings?.playoffTeamCount || 4,
            },
            avatar: avatar,
            raw_espn: data,
        };
    } catch (error) {
        console.error("ESPN Adapter Error:", error);
        throw error;
    }
};

// This account's ESPN identity (its SWID cookie), so a roster fetch can tell
// which team belongs to the connecting user the same reliable way Yahoo does
// with `is_owned_by_current_login` -- by identity, not a stored team-name
// string that can be stale or never captured.
const fetchResolvedSwid = async (userId) => {
    const { data } = await supabase
        .from('user_integrations')
        .select('refresh_token')
        .eq('user_id', userId)
        .eq('provider', 'espn')
        .maybeSingle();
    return data?.refresh_token || null;
};

// Rosters + standings, in the shape the rest of the app already consumes for
// Sleeper/Yahoo. `week`, when given, also resolves each starter's actual and
// projected points for that scoring period. `teamsOnly` skips the `mRoster`
// view entirely -- the history pages (records, trophy room, managers) only
// need each team's record, name and manager, and walking many past seasons
// at full roster detail costs one proxy call's worth of every player's stats
// per season for nothing any of those pages read.
export const fetchAndNormalizeESPNRosters = async (leagueId, { week = null, passedUserId = null, teamsOnly = false } = {}) => {
    const userId = await getUserId(passedUserId);
    if (!userId) return { rosters: {}, startersAndReserve: [], yahooPlayersMeta: {} };

    try {
        const views = teamsOnly ? ['mTeam'] : ['mTeam', 'mRoster'];
        const data = await espnProxyRequest(leagueId, { views, scoringPeriodId: week }, userId);
        if (!data) return { rosters: {}, startersAndReserve: [], yahooPlayersMeta: {} };

        const resolvedSwid = await fetchResolvedSwid(userId).catch(() => null);
        return parseEspnLeagueRosters(data, { week, resolvedSwid });
    } catch (err) {
        console.error("ESPN Rosters Adapter Error:", err);
        return { rosters: {}, startersAndReserve: [], yahooPlayersMeta: {} };
    }
};

// The full season's schedule in one call -- ESPN's `mMatchup` view returns
// every matchup period at once, unlike Yahoo which needs one proxy call per
// week. Cached per-process so a page asking for several weeks (the matchup
// history walk) doesn't refetch the same season repeatedly.
const scheduleCache = new Map();

export const fetchESPNSchedule = async (leagueId, { passedUserId = null, bypassCache = false } = {}) => {
    const userId = await getUserId(passedUserId);
    if (!userId) return {};
    const cacheKey = `${leagueId}:${userId}`;
    if (!bypassCache && scheduleCache.has(cacheKey)) return scheduleCache.get(cacheKey);

    try {
        const data = await espnProxyRequest(leagueId, { views: ['mMatchup'] }, userId);
        const byWeek = data ? parseEspnSchedule(data.schedule) : {};
        scheduleCache.set(cacheKey, byWeek);
        return byWeek;
    } catch (err) {
        console.error("ESPN Schedule Adapter Error:", err);
        return {};
    }
};

// Single-week view, in the shape the matchup pages already consume for Yahoo
// (fetchAndNormalizeYahooMatchups): { matchups: { idx: [team, team] }, week }.
export const fetchAndNormalizeESPNMatchups = async (leagueId, week = 1, passedUserId = null) => {
    const safeWeek = parseInt(week) || 1;
    const byWeek = await fetchESPNSchedule(leagueId, { passedUserId, bypassCache: true });
    const pairs = byWeek[safeWeek] || [];

    const matchups = {};
    pairs.forEach((teams, idx) => { matchups[idx + 1] = teams; });

    return { matchups, week: safeWeek };
};

export const fetchESPNTransactions = async (leagueId, passedUserId = null) => {
    const userId = await getUserId(passedUserId);
    if (!userId) return { transactions: [], playerMeta: {} };

    try {
        const data = await espnProxyRequest(leagueId, { views: ['mTransactions2'] }, userId);
        if (!data) return { transactions: [], playerMeta: {} };

        // ESPN's transaction feed carries no player name -- only a bare id --
        // so the current rosters' own player details are the best fallback for
        // whichever of them the shared dictionary's espn_id crosswalk misses.
        // A player who was dropped and is on no current roster stays
        // unresolved, the same graceful-degradation the Yahoo crosswalk gaps
        // already fall back to elsewhere in the app.
        const rostersData = await fetchAndNormalizeESPNRosters(leagueId, { passedUserId: userId }).catch(() => null);
        const playerMeta = rostersData?.yahooPlayersMeta || {};

        return { transactions: parseEspnTransactions(data.transactions), playerMeta };
    } catch (err) {
        console.error("ESPN Transactions Adapter Error:", err);
        return { transactions: [], playerMeta: {} };
    }
};

// ESPN's draft board for whichever season `leagueId` names (the live season
// by default, or a specific past one via its season-qualified form -- see
// platformIds.js).
export const fetchESPNDraft = async (leagueId, { season = null, passedUserId = null } = {}) => {
    const userId = await getUserId(passedUserId);
    if (!userId) return null;

    try {
        const [data, rostersData] = await Promise.all([
            espnProxyRequest(leagueId, { views: ['mDraftDetail', 'mSettings'] }, userId),
            fetchAndNormalizeESPNRosters(leagueId, { passedUserId: userId }).catch(() => null),
        ]);
        if (!data?.draftDetail) return null;

        const isAuction = String(data.settings?.draftSettings?.type || '').toUpperCase() === 'AUCTION';
        const board = parseEspnDraftDetail(data.draftDetail, { season: season || data.seasonId, isAuction });
        if (!board) return null;

        board.playerMeta = rostersData?.yahooPlayersMeta || {};
        return board;
    } catch (err) {
        console.error("ESPN Draft Adapter Error:", err);
        return null;
    }
};

// One season's finish order, in the shape buildPodiumFromStandings (shared
// with Yahoo's own trophy-room walk) already consumes: a rosterId, its final
// rank, and its division. ESPN reports the final rank a completed season's
// teams actually finished in as `rankCalculatedFinal` -- the regular-season
// standings position (`playoffSeed`) is what the playoff bracket started
// from, not who actually won it, so that's only a fallback for a season
// ESPN hasn't calculated a final rank for yet.
export const fetchESPNStandings = async (leagueId, passedUserId = null) => {
    const userId = await getUserId(passedUserId);
    if (!userId) return [];

    try {
        const data = await espnProxyRequest(leagueId, { views: ['mTeam'] }, userId);
        const teams = Array.isArray(data?.teams) ? data.teams : [];

        return teams.map(t => ({
            rosterId: t.id,
            rank: Number.isFinite(t.rankCalculatedFinal) && t.rankCalculatedFinal > 0
                ? t.rankCalculatedFinal
                : (t.playoffSeed || null),
            divisionId: Number.isFinite(t.divisionId) ? t.divisionId : null,
        }));
    } catch (err) {
        console.error("ESPN Standings Adapter Error:", err);
        return [];
    }
};
