import { supabase } from '../supabaseClient';

const getCleanYahooLeagueKey = (rawId) => {
    if (!rawId) return null;
    const str = String(rawId).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(str)) return null;
    if (str.includes('.l.')) return str;
    return `nfl.l.${str}`;
};

const getUserId = async (explicitUserId) => {
    if (explicitUserId) return explicitUserId;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
};

// 1. LEAGUE INFO & SETTINGS
export const fetchAndNormalizeYahooLeague = async (leagueId, passedUserId = null) => {
    const cleanKey = getCleanYahooLeagueKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return null;

    try {
        const response = await fetch('/api/yahoo-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId, 
                endpoint: `league/${cleanKey}/settings` 
            })
        });

        if (!response.ok) return null;

        const data = await response.json();
        const leagueData = data?.fantasy_content?.league?.[0];
        const settingsData = data?.fantasy_content?.league?.[1]?.settings?.[0];

        if (!leagueData) return null;

        const season = leagueData.season || new Date().getFullYear().toString();
        const totalRosters = parseInt(leagueData.num_teams) || 10;
        const playoffWeekStart = settingsData?.playoff_start_week ? parseInt(settingsData.playoff_start_week) : 15;

        return {
            league_id: cleanKey,
            sleeper_league_id: cleanKey,
            id: cleanKey,
            name: leagueData.name || `Yahoo League ${cleanKey}`,
            season: season,
            status: leagueData.is_finished ? 'complete' : 'in_season',
            total_rosters: totalRosters,
            avatar: leagueData.logo_url || '/brand.png',
            platform: 'yahoo',
            settings: {
                playoff_week_start: playoffWeekStart,
                divisions: 0,
                playoff_teams: 6,
                type: 0
            },
            metadata: {},
            raw_yahoo: data
        };
    } catch (error) {
        console.error("Yahoo League Adapter Error:", error);
        return null;
    }
};

// 2. ROSTERS & PLAYERS (Updated to fetch full team rosters)
export const fetchAndNormalizeYahooRosters = async (leagueId, passedUserId = null) => {
    const cleanKey = getCleanYahooLeagueKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return { rosters: {}, startersAndReserve: [] };

    try {
        const response = await fetch('/api/yahoo-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId, 
                endpoint: `league/${cleanKey}/teams/roster` 
            })
        });

        if (!response.ok) return { rosters: {}, startersAndReserve: [] };

        const data = await response.json();
        const teamsData = data?.fantasy_content?.league?.[1]?.teams;
        if (!teamsData) return { rosters: {}, startersAndReserve: [] };

        const rosterMap = {};
        const startersAndReserve = [];

        Object.keys(teamsData).forEach((k) => {
            if (k === 'count') return;
            const teamWrapper = teamsData[k]?.team;
            if (!teamWrapper) return;

            const teamInfo = teamWrapper[0];
            const rosterData = teamWrapper[1]?.roster?.[0];

            const teamKey = teamInfo?.find(x => x.team_key)?.team_key || `team_${k}`;
            const teamId = parseInt(teamInfo?.find(x => x.team_id)?.team_id) || (parseInt(k) + 1);
            const teamName = teamInfo?.find(x => x.name)?.name || `Team ${teamId}`;
            const teamLogo = teamInfo?.find(x => x.team_logos)?.team_logos?.[0]?.team_logo?.url || '/brand.png';
            const managers = teamInfo?.find(x => x.managers)?.managers || [];
            const primaryManager = managers[0]?.manager?.nickname || teamName;

            const playersArr = [];
            const startersArr = [];

            if (rosterData?.players) {
                const pObj = rosterData.players;
                Object.keys(pObj).forEach((pK) => {
                    if (pK === 'count') return;
                    const pItem = pObj[pK]?.player?.[0];
                    if (!pItem) return;

                    const pId = pItem.find(x => x.player_id)?.player_id;
                    const pSelectedPosition = pObj[pK]?.player?.[1]?.selected_position?.[1]?.position;

                    if (pId) {
                        playersArr.push(pId);
                        if (pSelectedPosition && pSelectedPosition !== 'BN' && pSelectedPosition !== 'IR') {
                            startersArr.push(pId);
                            startersAndReserve.push(pId);
                        }
                    }
                });
            }

            rosterMap[teamId] = {
                roster_id: teamId,
                owner_id: teamKey,
                team_name: teamName,
                avatar: teamLogo,
                manager_name: primaryManager,
                players: playersArr,
                starters: startersArr,
                reserve: [],
                settings: {
                    wins: 0,
                    losses: 0,
                    ties: 0,
                    fpts: 0,
                    fpts_decimal: 0,
                    fpts_against: 0,
                    fpts_against_decimal: 0,
                    division: 1
                },
                metadata: { streak: 0 }
            };
        });

        return { rosters: rosterMap, startersAndReserve };
    } catch (err) {
        console.error("Yahoo Rosters Adapter Error:", err);
        return { rosters: {}, startersAndReserve: [] };
    }
};

// 3. MATCHUPS & SCOREBOARD
export const fetchAndNormalizeYahooMatchups = async (leagueId, week = 1, passedUserId = null) => {
    const cleanKey = getCleanYahooLeagueKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return { matchups: {}, week };

    try {
        const response = await fetch('/api/yahoo-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId, 
                endpoint: `league/${cleanKey}/scoreboard;week=${week}` 
            })
        });

        if (!response.ok) return { matchups: {}, week };

        const data = await response.json();
        const matchupsData = data?.fantasy_content?.league?.[1]?.scoreboard?.[0]?.matchups;
        if (!matchupsData) return { matchups: {}, week };

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

        return { matchups, week };
    } catch (err) {
        console.error("Yahoo Matchups Adapter Error:", err);
        return { matchups, week };
    }
};