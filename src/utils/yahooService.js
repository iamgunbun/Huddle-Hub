import { supabase } from '../supabaseClient';
import { buildYahooScoringSettings } from './yahooScoring';

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

// The "nfl" literal is a Yahoo-supported alias for "whatever game key is
// currently active" -- it can only ever resolve the CURRENT season, but it's
// a useful fallback if a request built with the real (season-specific) game
// key gets rejected for some account/scope reason we can't fully diagnose
// from here. Only meaningful for a key that isn't already using the alias.
const getNflAliasKey = (cleanKey) => {
    if (!cleanKey || cleanKey.startsWith('nfl.l.')) return null;
    const match = cleanKey.match(/(\d+)$/);
    return match ? `nfl.l.${match[1]}` : null;
};

// Calls /api/yahoo-proxy for the given key, logging the real Yahoo error
// (status + body) instead of silently swallowing it. If the primary key
// fails and a fallback key is supplied, retries once with that key.
const yahooProxyRequest = async (userId, endpointForKey, primaryKey, fallbackKey, label) => {
    const attempt = async (key) => {
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

    let data = await attempt(primaryKey);
    if (!data && fallbackKey && fallbackKey !== primaryKey) {
        console.warn(`Yahoo proxy [${label}] retrying with fallback key "${fallbackKey}" after "${primaryKey}" failed.`);
        data = await attempt(fallbackKey);
    }
    return data;
};

// 1. LEAGUE INFO & SETTINGS
export const fetchAndNormalizeYahooLeague = async (leagueId, passedUserId = null) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return null;

    try {
        const data = await yahooProxyRequest(
            userId,
            (key) => `league/${key}/settings`,
            cleanKey,
            getNflAliasKey(cleanKey),
            'league settings'
        );
        if (!data) return null;

        const leagueData = data?.fantasy_content?.league?.[0];
        const settingsData = data?.fantasy_content?.league?.[1]?.settings?.[0];

        if (!leagueData) return null;

        const season = leagueData.season || new Date().getFullYear().toString();
        const totalRosters = parseInt(leagueData.num_teams) || 10;
        const playoffWeekStart = settingsData?.playoff_start_week ? parseInt(settingsData.playoff_start_week) : 15;

        // Yahoo tracks cross-season lineage via "renew" (points at the prior
        // season's league in "<game_key>_<league_id>" form). Mirroring Sleeper's
        // previous_league_id lets every history-walking loop in the app (records,
        // team managers, rivalry, drafts, etc.) traverse Yahoo leagues the same way.
        const previousLeagueId = leagueData.renew ? cleanYahooKey(leagueData.renew) : null;
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
            name: leagueData.name || `Yahoo League ${cleanKey}`,
            season: season,
            status: leagueData.is_finished ? 'complete' : 'in_season',
            total_rosters: totalRosters,
            avatar: leagueData.logo_url || '/brand.png',
            platform: 'yahoo',
            roster_positions: DEFAULT_POSITIONS,
            scoring_settings: scoringSettings,
            settings: {
                playoff_week_start: playoffWeekStart,
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
            getNflAliasKey(cleanKey),
            'league standings'
        ) || {};

        const standingsMap = {};
        const teamKeys = [];
        
        const stLeagueObj = sData?.fantasy_content?.league;
        if (Array.isArray(stLeagueObj)) {
            const stWrapper = stLeagueObj.find(x => x && x.standings);
            const stTeams = stWrapper?.standings?.[0]?.teams;
            if (stTeams) {
                Object.keys(stTeams).forEach(k => {
                    if (k === 'count') return;
                    const tm = stTeams[k]?.team;
                    if (!Array.isArray(tm)) return;
                    
                    const tmInfo = tm[0];
                    const tmStats = tm[1]?.team_standings;
                    
                    let tKey = '';
                    let tId = null;

                    if (Array.isArray(tmInfo)) {
                        tKey = tmInfo.find(x => x.team_key)?.team_key;
                        tId = parseInt(tmInfo.find(x => x.team_id)?.team_id);
                    }

                    if (tKey) teamKeys.push(tKey);
                    
                    if (tId && tmStats) {
                        const totals = tmStats.outcome_totals || {};
                        standingsMap[tId] = {
                            roster_id: tId,
                            wins: parseInt(totals.wins) || 0,
                            losses: parseInt(totals.losses) || 0,
                            ties: parseInt(totals.ties) || 0,
                            fpts: parseFloat(tmStats.points_for) || 0,
                            fpts_against: parseFloat(tmStats.points_against) || 0,
                            streak: tmStats.streak?.value || 0
                        };
                    }
                });
            }
        }

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

            const sMap = standingsMap[teamId] || {};
            const fpts = sMap.fpts || 0;
            const fptsAgainst = sMap.fpts_against || 0;

            rosterMap[teamId] = {
                roster_id: teamId,
                owner_id: teamKey,
                team_name: teamName,
                avatar: teamLogo,
                manager_name: primaryManager,
                players: playersArr,
                starters: startersArr,
                reserve: [],
                is_owned_by_current_login: isOwnedByCurrentLogin,
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
        });

        return { rosters: rosterMap, startersAndReserve, yahooPlayersMeta };
    } catch (err) {
        console.error("Yahoo Rosters Adapter Error:", err);
        return { rosters: {}, startersAndReserve: [], yahooPlayersMeta: {} };
    }
};

// 3. MATCHUPS & SCOREBOARD
export const fetchAndNormalizeYahooMatchups = async (leagueId, week = 1, passedUserId = null) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    const safeWeek = parseInt(week) || 1;
    if (!cleanKey || !userId) return { matchups: {}, week: safeWeek };

    try {
        const data = await yahooProxyRequest(
            userId,
            (key) => `league/${key}/scoreboard;week=${safeWeek}`,
            cleanKey,
            getNflAliasKey(cleanKey),
            `scoreboard week ${safeWeek}`
        );
        if (!data) return { matchups: {}, week: safeWeek };

        const matchupsData = data?.fantasy_content?.league?.[1]?.scoreboard?.[0]?.matchups;
        if (!matchupsData) return { matchups: {}, week: safeWeek };

        const matchups = {};

        Object.keys(matchupsData).forEach((mKey, idx) => {
            if (mKey === 'count') return;
            const matchupItem = matchupsData[mKey]?.matchup;
            if (!matchupItem) return;

            const matchupId = idx + 1;
            matchups[matchupId] = [];

            const teams = matchupItem[0]?.teams;
            if (teams) {
                Object.keys(teams).forEach((tKey) => {
                    if (tKey === 'count') return;
                    const teamObj = teams[tKey]?.team;
                    if (!teamObj) return;

                    const teamInfo = teamObj[0];
                    const teamPoints = teamObj[1]?.team_points;

                    const teamId = parseInt(teamInfo?.find(x => x.team_id)?.team_id) || (parseInt(tKey) + 1);
                    const points = parseFloat(teamPoints?.total) || 0;

                    matchups[matchupId].push({
                        roster_id: teamId,
                        starters: [],
                        points: points,
                        starters_points: []
                    });
                });
            }
        });

        return { matchups, week: safeWeek };
    } catch (err) {
        console.error("Yahoo Matchups Adapter Error:", err);
        return { matchups: {}, week: safeWeek };
    }
};

// 4. AVAILABLE PLAYERS (league free agents + waivers)
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
                getNflAliasKey(cleanKey),
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
