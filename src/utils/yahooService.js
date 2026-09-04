import { supabase } from '../supabaseClient';
import { buildYahooScoringSettings } from './yahooScoring';
import {
    parseYahooStandings,
    parseYahooScoreboard,
    parseYahooDraftResults,
    buildYahooDraftBoard,
    parseYahooUserLeagueKeys,
    isKeyInUserLeagues,
    yahooCollection,
} from './yahooHistory';

export const cleanYahooKey = (rawId) => {
    if (!rawId) return null;
    let str = String(rawId).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(str)) return null;

    // Already a fully-formed Yahoo league key, e.g. "461.l.123456".
    // The game key portion is season-specific -- it must be preserved as-is,
    // since rewriting it to the generic "nfl" alias silently reroutes any
    // lookup to the CURRENT season, breaking every past-season fetch.
    if (/^\d+\.l\.\d+$/.test(str)) return str;

    // Yahoo's league "renew"/"renewed" fields point at the adjacent season's
    // league using "<game_key>_<league_id>" (e.g. "371_811308"). Convert that
    // into a proper league key so it can be re-queried.
    const renewMatch = str.match(/^(\d+)_(\d+)$/);
    if (renewMatch) {
        return `${renewMatch[1]}.l.${renewMatch[2]}`;
    }

    // Last-resort fallback for a bare numeric ID with no known game key --
    // route through the current season since that's the best guess available.
    const match = str.match(/(\d+)$/);
    if (match) {
        return `nfl.l.${match[1]}`;
    }
    return null;
};

const getUserId = async (explicitUserId) => {
    if (explicitUserId) return explicitUserId;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
};

const DEFAULT_POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];

// Calls /api/yahoo-proxy for the given key, logging the real Yahoo error
// (status + body) instead of silently swallowing it.
//
// There used to be a retry here against Yahoo's "nfl" alias key (nfl.l.<id>)
// whenever a request with the real season key failed. That alias means "the
// league with this id IN THE CURRENT SEASON", and Yahoo mints a NEW league id
// every season -- so for any past-season key the alias does not name this
// league at all. It names whichever unrelated league happens to hold that id
// this year, and because Yahoo serves public leagues to any authenticated
// caller, it would happily return one. A past season the user can't read
// (they joined the league later, say) therefore came back as a STRANGER'S
// league, and the walk then followed that league's own renew chain: bogus
// champions, and all-time records built out of other people's seasons.
//
// For a current-season key the alias resolves to the same league and adds
// nothing; for a past-season key it is actively wrong. So it's gone.
const yahooProxyRequest = async (userId, endpointForKey, key, label) => {
    if (!key) return null;
    try {
        const res = await fetch('/api/yahoo-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, endpoint: endpointForKey(key) })
        });
        if (!res.ok) {
            const bodyText = await res.text().catch(() => '');
            console.error(`Yahoo proxy [${label}] failed for key "${key}" (HTTP ${res.status}): ${bodyText}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        console.error(`Yahoo proxy [${label}] threw for key "${key}":`, err);
        return null;
    }
};

// Which leagues does this account actually belong to?
//
// A league's renew chain describes the LEAGUE's lineage, not the user's. A
// league can be eleven seasons old while the account joined last year, and
// nothing in the league response says which is which -- so following the chain
// blindly builds "all-time" records out of seasons the user was never in, and
// crowns champions they never played against. Yahoo will answer this directly:
// game_codes=nfl (as opposed to game_keys=nfl, which is only the current
// season) lists every NFL league the login has ever been part of.
//
// Fetched once per page load. If it can't be determined the walk is left alone
// rather than blocked -- the league-key and renew-chain checks still apply.
const userLeagueKeysByUser = new Map();

const loadUserLeagueKeys = async (userId) => {
    if (!userLeagueKeysByUser.has(userId)) {
        userLeagueKeysByUser.set(userId, (async () => {
            const data = await yahooProxyRequest(
                userId,
                () => 'users;use_login=1/games;game_codes=nfl/leagues',
                'user-leagues',
                'user league list'
            );
            if (!data) return null;
            const keys = parseYahooUserLeagueKeys(data);
            return keys.size ? keys : null;
        })());
    }
    return userLeagueKeysByUser.get(userId);
};

/**
 * True when this league key is one the account is a member of, OR when
 * membership couldn't be established (in which case we don't block).
 */
const isUsersOwnLeague = async (leagueKey, userId) => {
    try {
        const keys = await loadUserLeagueKeys(userId);
        if (!keys) return true;
        return isKeyInUserLeagues(leagueKey, keys);
    } catch (err) {
        console.warn("Couldn't confirm which Yahoo leagues this account is in:", err);
        return true;
    }
};

// 1. LEAGUE INFO & SETTINGS
export const fetchAndNormalizeYahooLeague = async (leagueId, passedUserId = null) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return null;

    try {
        // A season the account was never part of isn't this user's history.
        if (!(await isUsersOwnLeague(cleanKey, userId))) {
            console.warn(
                `Yahoo league "${cleanKey}" isn't one this account is a member of -- leaving it out of the league's history.`
            );
            return null;
        }

        const data = await yahooProxyRequest(
            userId,
            (key) => `league/${key}/settings`,
            cleanKey,
            'league settings'
        );
        if (!data) return null;

        const leagueData = data?.fantasy_content?.league?.[0];
        const settingsData = data?.fantasy_content?.league?.[1]?.settings?.[0];

        if (!leagueData) return null;

        // Never ingest a league we didn't ask for. Walking a season chain means
        // requesting keys derived from Yahoo's own "renew" pointers, and a
        // wrong or stale pointer would otherwise splice another league's teams,
        // champions and records into this league's history without a trace.
        // The one legitimate mismatch is the "nfl" alias form, which Yahoo
        // resolves to the current season's real game key.
        const returnedKey = leagueData.league_key;
        if (returnedKey && returnedKey !== cleanKey) {
            const aliasedToSameLeague = cleanKey.startsWith('nfl.l.')
                && returnedKey.endsWith(`.l.${cleanKey.slice('nfl.l.'.length)}`);
            if (!aliasedToSameLeague) {
                console.warn(
                    `Yahoo returned league "${returnedKey}" for a request for "${cleanKey}" -- ignoring it ` +
                    `rather than mixing another league's history into this one.`
                );
                return null;
            }
        }

        const season = leagueData.season || new Date().getFullYear().toString();
        const totalRosters = parseInt(leagueData.num_teams) || 10;
        const playoffWeekStart = settingsData?.playoff_start_week ? parseInt(settingsData.playoff_start_week) : 15;
        // Yahoo states where the season actually ends, which varies by league
        // (17 vs 18) and by era. The playoff walk needs it to know how many
        // weeks of postseason to ask for instead of guessing three rounds.
        const startWeek = parseInt(leagueData.start_week) || 1;
        const endWeek = parseInt(leagueData.end_week) || (playoffWeekStart + 2);
        // An auction draft has costs instead of a pick order, so the draft board
        // has to be laid out differently.
        const isAuctionDraft = Number(settingsData?.is_auction_draft) === 1;

        // Yahoo tracks cross-season lineage via "renew" (points at the prior
        // season's league in "<game_key>_<league_id>" form). Mirroring Sleeper's
        // previous_league_id lets every history-walking loop in the app (records,
        // team managers, rivalry, drafts, etc.) traverse Yahoo leagues the same way.
        const previousLeagueId = leagueData.renew ? cleanYahooKey(leagueData.renew) : null;
        // Yahoo's forward pointer. A previous season should name THIS league as
        // what it was renewed into; when it doesn't, the chain has wandered
        // somewhere it shouldn't and the walk stops.
        const renewedLeagueId = leagueData.renewed ? cleanYahooKey(leagueData.renewed) : null;
        // Built from Yahoo's own stat_categories + stat_modifiers, so the league's
        // exact scoring (including kicker and defense categories) carries over.
        const scoringSettings = buildYahooScoringSettings(settingsData);

        // An empty result means no category resolved, and every projection would
        // then quietly fall back to Sleeper's generic standard scoring -- numbers
        // that look plausible but aren't this league's. Surface it rather than
        // letting it pass unnoticed.
        if (!Object.keys(scoringSettings).length) {
            console.warn(
                `Yahoo league ${cleanKey}: could not resolve any scoring categories from the league settings. ` +
                `Projections will fall back to generic scoring instead of this league's format.`,
                { stat_categories: settingsData?.stat_categories, stat_modifiers: settingsData?.stat_modifiers }
            );
        }

        return {
            league_id: cleanKey,
            sleeper_league_id: cleanKey,
            id: cleanKey,
            previous_league_id: previousLeagueId,
            renewed_league_id: renewedLeagueId,
            name: leagueData.name || `Yahoo League ${cleanKey}`,
            season: season,
            status: leagueData.is_finished ? 'complete' : 'in_season',
            draft_status: leagueData.draft_status || null,
            total_rosters: totalRosters,
            avatar: leagueData.logo_url || '/brand.png',
            platform: 'yahoo',
            roster_positions: DEFAULT_POSITIONS,
            scoring_settings: scoringSettings,
            settings: {
                playoff_week_start: playoffWeekStart,
                start_week: startWeek,
                end_week: endWeek,
                is_auction_draft: isAuctionDraft,
                divisions: 0,
                playoff_teams: 6,
                type: 0,
                roster_positions: DEFAULT_POSITIONS
            },
            metadata: {},
            raw_yahoo: data
        };
    } catch (error) {
        console.error("Yahoo League Adapter Error:", error);
        return null;
    }
};

// A standings row, in the roster shape the rest of the app consumes.
//
// A manager's identity has to be the Yahoo guid, not the team key. A team key
// carries the season's game key ("461.l.123.t.5"), so keying managers by it
// makes every season look like a different set of people -- all-time records,
// rivalries and the trophy room then never accumulate past a single year. Guids
// are stable across seasons; the team key stays available separately for the
// roster and matchup endpoints that genuinely need it.
const standingsRowToRoster = (row, overrides = {}) => {
    const sMap = row || {};
    const fpts = sMap.pointsFor || 0;
    const fptsAgainst = sMap.pointsAgainst || 0;
    const rosterId = overrides.rosterId ?? sMap.rosterId;
    const teamKey = overrides.teamKey ?? sMap.teamKey;
    const managerGuids = (sMap.managerGuids?.length ? sMap.managerGuids : overrides.managerGuids) || [];

    return {
        roster_id: rosterId,
        owner_id: managerGuids[0] || teamKey,
        co_owners: managerGuids.slice(1),
        team_key: teamKey || null,
        team_name: overrides.teamName ?? sMap.teamName ?? `Team ${rosterId}`,
        avatar: overrides.teamLogo ?? sMap.logoUrl ?? '/brand.png',
        manager_name: overrides.managerName ?? sMap.managerName ?? overrides.teamName ?? sMap.teamName,
        players: [],
        starters: [],
        reserve: [],
        is_owned_by_current_login: overrides.isOwnedByCurrentLogin ?? sMap.isOwnedByCurrentLogin ?? false,
        rank: sMap.rank ?? null,
        playoff_seed: sMap.playoffSeed ?? null,
        settings: {
            wins: sMap.wins || 0,
            losses: sMap.losses || 0,
            ties: sMap.ties || 0,
            fpts: Math.floor(fpts),
            fpts_decimal: Math.round((fpts % 1) * 100),
            fpts_against: Math.floor(fptsAgainst),
            fpts_against_decimal: Math.round((fptsAgainst % 1) * 100),
            division: 1
        },
        metadata: { streak: sMap.streak || 0 }
    };
};

// Teams, records and managers for one season -- WITHOUT each team's player list.
//
// Walking a league's history needs this for every past season, and the full
// roster fetch costs one proxy call per team per season (a six-season, ten-team
// league would be ~66 calls just to draw the records page). Standings alone
// answers everything the history pages ask for in a single call.
export const fetchYahooSeasonTeams = async (leagueId, passedUserId = null) => {
    const rows = await fetchYahooStandings(leagueId, passedUserId);
    const rosters = {};
    rows.forEach(row => {
        if (row.rosterId === null || row.rosterId === undefined) return;
        rosters[row.rosterId] = standingsRowToRoster(row);
    });
    return { rosters, startersAndReserve: [], yahooPlayersMeta: {} };
};

// 2. ROSTERS & STANDINGS (Parallel Fetch)
export const fetchAndNormalizeYahooRosters = async (leagueId, passedUserId = null) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return { rosters: {}, startersAndReserve: [] };

    try {
        // Step 1: Fetch Standings to map records and obtain correct Team Keys
        const sData = await yahooProxyRequest(
            userId,
            (key) => `league/${key}/standings`,
            cleanKey,
            'league standings'
        ) || {};

        const standingsRows = parseYahooStandings(sData);
        const standingsMap = {};
        const teamKeys = [];

        standingsRows.forEach(row => {
            if (row.teamKey) teamKeys.push(row.teamKey);
            if (row.rosterId !== null) standingsMap[row.rosterId] = row;
        });

        // Step 2: Fetch every team's roster explicitly in parallel
        // (team keys come straight from the standings response above, so they
        // don't need cleanYahooKey/fallback handling -- they're already correct)
        const teamPromises = teamKeys.map(tKey =>
            fetch('/api/yahoo-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, endpoint: `team/${tKey}/roster` })
            }).then(async (res) => {
                if (res.ok) return res.json();
                const bodyText = await res.text().catch(() => '');
                console.error(`Yahoo proxy [team roster] failed for team "${tKey}" (HTTP ${res.status}): ${bodyText}`);
                return null;
            }).catch((err) => {
                console.error(`Yahoo proxy [team roster] threw for team "${tKey}":`, err);
                return null;
            })
        );

        const teamsDataArray = await Promise.all(teamPromises);

        // A failed team fetch is dropped below, which silently removes that
        // team's players from the league's "owned" set -- they then look like
        // free agents. Say so rather than letting the gap pass unnoticed.
        const failedTeams = teamsDataArray.filter(t => !t).length;
        if (failedTeams) {
            console.warn(
                `Yahoo league ${cleanKey}: ${failedTeams} of ${teamKeys.length} team rosters failed to load. ` +
                `Players on those teams may incorrectly appear as available.`
            );
        }

        const rosterMap = {};
        const startersAndReserve = [];
        // Yahoo's own roster response already carries each player's name/team/
        // position/photo. Sleeper's yahoo_id crosswalk (used to key the shared
        // player database) is community-maintained and has real gaps -- so this
        // is captured as a fallback the UI can use for any player that crosswalk
        // misses, instead of leaving those slots blank.
        const yahooPlayersMeta = {};

        teamsDataArray.forEach(tData => {
            if (!tData) return;
            const teamWrapper = tData?.fantasy_content?.team;
            if (!Array.isArray(teamWrapper)) return;

            const teamInfoArray = teamWrapper[0];
            if (!Array.isArray(teamInfoArray)) return;

            const teamKey = teamInfoArray.find(x => x.team_key)?.team_key;
            if (!teamKey) return;

            const teamId = parseInt(teamInfoArray.find(x => x.team_id)?.team_id);
            const teamName = teamInfoArray.find(x => x.name)?.name || `Team ${teamId}`;
            
            let teamLogo = '/brand.png';
            const logosArr = teamInfoArray.find(x => x.team_logos)?.team_logos;
            if (Array.isArray(logosArr) && logosArr[0]?.team_logo?.url) teamLogo = logosArr[0].team_logo.url;

            let primaryManager = teamName;
            const managersArr = teamInfoArray.find(x => x.managers)?.managers;
            if (Array.isArray(managersArr) && managersArr[0]?.manager?.nickname) primaryManager = managersArr[0].manager.nickname;

            // Yahoo flags the requesting user's own team directly -- far more
            // reliable than matching a stored team name string, which can be
            // stale or (for older connections) never captured correctly at all.
            const isOwnedByCurrentLogin = Number(teamInfoArray.find(x => x.is_owned_by_current_login)?.is_owned_by_current_login) === 1;

            const playersArr = [];
            const startersArr = [];
            
            const rosterObjWrapper = teamWrapper.find(x => x && x.roster);
            
            if (rosterObjWrapper && rosterObjWrapper.roster) {
                const rObj = rosterObjWrapper.roster;
                const playersNode = Object.values(rObj).find(val => val && val.players)?.players;
                
                if (playersNode) {
                    Object.keys(playersNode).forEach(pK => {
                        if (pK === 'count') return;
                        const pItemWrapper = playersNode[pK]?.player;
                        if (!Array.isArray(pItemWrapper)) return;
                        
                        const pInfo = pItemWrapper[0];
                        if (!Array.isArray(pInfo)) return;
                        
                        const pId = pInfo.find(x => x.player_id)?.player_id;
                        const pSelectedPosition = pItemWrapper[1]?.selected_position?.[1]?.position;

                        if (pId) {
                            const stringId = String(pId);
                            playersArr.push(stringId);
                            if (pSelectedPosition && pSelectedPosition !== 'BN' && pSelectedPosition !== 'IR') {
                                startersArr.push(stringId);
                                startersAndReserve.push(stringId);
                            }

                            if (!yahooPlayersMeta[stringId]) {
                                const pFullName = pInfo.find(x => x.name)?.name?.full || '';
                                const [pFirstName, ...pLastParts] = pFullName.split(' ');
                                yahooPlayersMeta[stringId] = {
                                    id: stringId,
                                    fn: pFirstName || pFullName,
                                    ln: pLastParts.join(' '),
                                    pos: pInfo.find(x => x.display_position)?.display_position || pSelectedPosition || '',
                                    t: pInfo.find(x => x.editorial_team_abbr)?.editorial_team_abbr?.toUpperCase() || 'FA',
                                    headshot: pInfo.find(x => x.headshot)?.headshot?.url || pInfo.find(x => x.image_url)?.image_url || null,
                                    injStatus: pInfo.find(x => x.status)?.status || null,
                                    wi: {}
                                };
                            }
                        }
                    });
                }
            }

            const rosterManagerGuids = yahooCollection(teamInfoArray.find(x => x.managers)?.managers)
                .map(m => m?.manager?.guid)
                .filter(Boolean);

            rosterMap[teamId] = {
                ...standingsRowToRoster(standingsMap[teamId], {
                    rosterId: teamId,
                    teamKey,
                    teamName,
                    teamLogo,
                    managerName: primaryManager,
                    isOwnedByCurrentLogin,
                    managerGuids: rosterManagerGuids,
                }),
                players: playersArr,
                starters: startersArr,
            };
        });

        return { rosters: rosterMap, startersAndReserve, yahooPlayersMeta };
    } catch (err) {
        console.error("Yahoo Rosters Adapter Error:", err);
        return { rosters: {}, startersAndReserve: [], yahooPlayersMeta: {} };
    }
};

// 3. STANDINGS (one season's finish order -- the basis of the trophy room)
//
// Yahoo publishes no bracket endpoint, so a finished season's standings rank
// IS the playoff result: rank 1 is that year's champion. Exposed on its own
// because the history walk needs ranks for seasons other than the current one.
export const fetchYahooStandings = async (leagueId, passedUserId = null) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return [];

    try {
        const data = await yahooProxyRequest(
            userId,
            (key) => `league/${key}/standings`,
            cleanKey,
            'league standings'
        );
        if (!data) return [];
        return parseYahooStandings(data);
    } catch (err) {
        console.error("Yahoo Standings Adapter Error:", err);
        return [];
    }
};

// 4. MATCHUPS & SCOREBOARD

// Yahoo accepts a comma-separated week list on the scoreboard endpoint, and
// walking a league's history needs a LOT of weeks: one request per week per
// season is dozens of proxy calls, and bursts of those are exactly what
// produced the intermittent 400s seen earlier. Weeks are requested in chunks,
// chunks run one after another, and a chunk that comes back empty falls back to
// single-week requests so a league Yahoo won't serve the multi-week form for
// still gets its history.
const WEEK_CHUNK = 6;

const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

export const fetchYahooScoreboardWeeks = async (leagueId, weeks, passedUserId = null) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    const wanted = (weeks || []).map(w => parseInt(w)).filter(w => Number.isFinite(w) && w > 0);
    if (!cleanKey || !userId || !wanted.length) return [];

    const collected = [];

    for (const group of chunk(wanted, WEEK_CHUNK)) {
        const data = await yahooProxyRequest(
            userId,
            (key) => `league/${key}/scoreboard;week=${group.join(',')}`,
            cleanKey,
            `scoreboard weeks ${group[0]}-${group[group.length - 1]}`
        );

        const parsed = data ? parseYahooScoreboard(data) : [];
        if (parsed.length) {
            collected.push(...parsed);
            continue;
        }

        for (const week of group) {
            const single = await yahooProxyRequest(
                userId,
                (key) => `league/${key}/scoreboard;week=${week}`,
                cleanKey,
                `scoreboard week ${week}`
            );
            if (single) collected.push(...parseYahooScoreboard(single, week));
        }
    }

    return collected;
};

// Single-week view, in the shape the matchup pages already consume.
export const fetchAndNormalizeYahooMatchups = async (leagueId, week = 1, passedUserId = null) => {
    const safeWeek = parseInt(week) || 1;
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return { matchups: {}, week: safeWeek };

    try {
        const data = await yahooProxyRequest(
            userId,
            (key) => `league/${key}/scoreboard;week=${safeWeek}`,
            cleanKey,
            `scoreboard week ${safeWeek}`
        );
        if (!data) return { matchups: {}, week: safeWeek };

        const matchups = {};
        parseYahooScoreboard(data, safeWeek).forEach((m, idx) => {
            matchups[idx + 1] = m.teams.map(t => ({
                roster_id: t.roster_id,
                starters: [],
                points: t.points,
                starters_points: []
            }));
        });

        return { matchups, week: safeWeek };
    } catch (err) {
        console.error("Yahoo Matchups Adapter Error:", err);
        return { matchups: {}, week: safeWeek };
    }
};

// 5. DRAFT RESULTS
//
// Yahoo returns a flat list of picks with no slot map and no draft order, so the
// board is reconstructed from the picks themselves (see buildYahooDraftBoard).
// Auction drafts come back with a cost per pick and no meaningful order.
export const fetchYahooDraft = async (leagueId, { season = null, isAuction = false, passedUserId = null } = {}) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return null;

    try {
        const data = await yahooProxyRequest(
            userId,
            (key) => `league/${key}/draftresults`,
            cleanKey,
            'draft results'
        );
        if (!data) return null;

        const picks = parseYahooDraftResults(data);
        if (!picks.length) return null;

        return buildYahooDraftBoard(picks, { leagueKey: cleanKey, season, isAuction });
    } catch (err) {
        console.error("Yahoo Draft Adapter Error:", err);
        return null;
    }
};

// 6. AVAILABLE PLAYERS (league free agents + waivers)
//
// Yahoo tracks its own pool, so ask it rather than inferring availability by
// subtracting rosters from a league-agnostic player database. status=A is
// "available" (free agents and waivers). Pages are fetched sequentially --
// bursts of parallel proxy calls are what produced intermittent 400s before.
export const fetchYahooAvailablePlayers = async (leagueId, { maxPlayers = 200, passedUserId = null } = {}) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return null;

    const PAGE = 25;
    const players = [];

    try {
        for (let start = 0; start < maxPlayers; start += PAGE) {
            const data = await yahooProxyRequest(
                userId,
                (key) => `league/${key}/players;status=A;sort=AR;start=${start};count=${PAGE}`,
                cleanKey,
                `available players ${start}-${start + PAGE}`
            );
            if (!data) break;

            const leagueNode = data?.fantasy_content?.league;
            const playersNode = Array.isArray(leagueNode)
                ? leagueNode.find(x => x && x.players)?.players
                : null;
            if (!playersNode) break;

            const before = players.length;
            Object.keys(playersNode).forEach(k => {
                if (k === 'count') return;
                const meta = playersNode[k]?.player?.[0];
                if (!Array.isArray(meta)) return;

                const pId = meta.find(x => x?.player_id)?.player_id;
                if (!pId) return;

                const fullName = meta.find(x => x?.name)?.name?.full || '';
                const [first, ...rest] = fullName.split(' ');
                players.push({
                    id: String(pId),
                    fn: first || fullName,
                    ln: rest.join(' '),
                    pos: meta.find(x => x?.display_position)?.display_position || '',
                    t: meta.find(x => x?.editorial_team_abbr)?.editorial_team_abbr?.toUpperCase() || 'FA',
                });
            });

            // No new rows means we've reached the end of the pool.
            if (players.length === before) break;
        }
    } catch (err) {
        console.error("Yahoo available-players fetch failed:", err);
        return players.length ? players : null;
    }

    return players.length ? players : null;
};
