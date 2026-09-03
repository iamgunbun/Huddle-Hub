import { supabase } from '../supabaseClient';

export const cleanYahooKey = (rawId) => {
    if (!rawId) return null;
    let str = String(rawId).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(str)) return null;
    
    // UNIVERSAL YAHOO KEY ROUTER:
    // Extract strictly the final numeric ID and prepend 'nfl.l.'
    // This forces Yahoo to automatically route to the current active season
    // and ignores invalid game keys (like 470 or .1.) that trigger 400 errors.
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

// 1. LEAGUE INFO & SETTINGS
export const fetchAndNormalizeYahooLeague = async (leagueId, passedUserId = null) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    if (!cleanKey || !userId) return null;

    try {
        const response = await fetch('/api/yahoo-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, endpoint: `league/${cleanKey}/settings` })
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
            roster_positions: DEFAULT_POSITIONS, 
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
        const standingsRes = await fetch('/api/yahoo-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, endpoint: `league/${cleanKey}/standings` })
        }).catch(() => null);

        const sData = standingsRes?.ok ? await standingsRes.json() : {};
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
        const teamPromises = teamKeys.map(tKey => 
            fetch('/api/yahoo-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, endpoint: `team/${tKey}/roster` })
            }).then(res => res.ok ? res.json() : null)
        );

        const teamsDataArray = await Promise.all(teamPromises);

        const rosterMap = {};
        const startersAndReserve = [];

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

        return { rosters: rosterMap, startersAndReserve };
    } catch (err) {
        console.error("Yahoo Rosters Adapter Error:", err);
        return { rosters: {}, startersAndReserve: [] };
    }
};

// 3. MATCHUPS & SCOREBOARD
export const fetchAndNormalizeYahooMatchups = async (leagueId, week = 1, passedUserId = null) => {
    const cleanKey = cleanYahooKey(leagueId);
    const userId = await getUserId(passedUserId);
    const safeWeek = parseInt(week) || 1;
    if (!cleanKey || !userId) return { matchups: {}, week: safeWeek };

    try {
        const response = await fetch('/api/yahoo-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, endpoint: `league/${cleanKey}/scoreboard;week=${safeWeek}` })
        });

        if (!response.ok) return { matchups: {}, week: safeWeek };

        const data = await response.json();
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