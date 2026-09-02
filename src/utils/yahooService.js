import { supabase } from '../supabaseClient';

// Helper to sanitize Yahoo League Keys (e.g., "470.l.604026" or "604026")
const getCleanYahooLeagueKey = (rawId) => {
    if (!rawId) return null;
    const str = String(rawId).trim();
    // Ignore Supabase database UUIDs
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(str)) return null;
    // If it already has the game prefix (e.g., "470.l.604026" or "nfl.l.604026")
    if (str.includes('.l.')) return str;
    // Pure numeric ID fallback
    return `nfl.l.${str}`;
};

// Helper to get active user ID without requiring callers to pass it
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

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Yahoo status ${response.status}`);
        }

        const data = await response.json();
        const leagueData = data?.fantasy_content?.league?.[0];
        const settingsData = data?.fantasy_content?.league?.[1]?.settings?.[0];

        if (!leagueData) throw new Error("Invalid Yahoo league data returned.");

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

// 2. ROSTERS & TEAMS (Sleeper format expected by getLeagueRosters)
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
                endpoint: `league/${cleanKey}/standings` 
            })
        });

        if (!response.ok) return { rosters: {}, startersAndReserve: [] };

        const data = await response.json();
        const teamsData = data?.fantasy_content?.league?.[1]?.standings?.[0]?.teams;
        if (!teamsData) return { rosters: {}, startersAndReserve: [] };

        const rosterMap = {};
        const startersAndReserve = [];

        // Yahoo wraps teams in numeric index objects
        Object.keys(teamsData).forEach((k) => {
            if (k === 'count') return;
            const teamWrapper = teamsData[k]?.team;
            if (!teamWrapper) return;

            const teamInfo = teamWrapper[0];
            const teamStandings = teamWrapper[1]?.team_standings;

            // Extract metadata
            const teamKey = teamInfo?.find(x => x.team_key)?.team_key || `team_${k}`;
            const teamId = teamInfo?.find(x => x.team_id)?.team_id || (parseInt(k) + 1);
            const teamName = teamInfo?.find(x => x.name)?.name || `Team ${teamId}`;
            const teamLogo = teamInfo?.find(x => x.team_logos)?.team_logos?.[0]?.team_logo?.url || '/brand.png';
            const managers = teamInfo?.find(x => x.managers)?.managers || [];
            const primaryManager = managers[0]?.manager?.nickname || teamName;

            // Extract records
            const totals = teamStandings?.outcome_totals || {};
            const wins = parseInt(totals.wins) || 0;
            const losses = parseInt(totals.losses) || 0;
            const ties = parseInt(totals.ties) || 0;
            const fpts = parseFloat(teamStandings?.points_for) || 0;
            const fptsAgainst = parseFloat(teamStandings?.points_against) || 0;

            const numericRosterId = parseInt(teamId);

            rosterMap[numericRosterId] = {
                roster_id: numericRosterId,
                owner_id: teamKey,
                team_name: teamName,
                avatar: teamLogo,
                manager_name: primaryManager,
                players: [],
                starters: [],
                reserve: [],
                settings: {
                    wins,
                    losses,
                    ties,
                    fpts: Math.floor(fpts),
                    fpts_decimal: Math.round((fpts % 1) * 100),
                    fpts_against: Math.floor(fptsAgainst),
                    fpts_against_decimal: Math.round((fptsAgainst % 1) * 100),
                    division: 1
                },
                metadata: {
                    streak: teamStandings?.streak?.value || 0
                }
            };
        });

        return { rosters: rosterMap, startersAndReserve };
    } catch (err) {
        console.error("Yahoo Rosters Adapter Error:", err);
        return { rosters: {}, startersAndReserve: [] };
    }
};

// 3. MATCHUPS & SCOREBOARD (Sleeper format expected by getLeagueMatchups)
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
        return { matchups: {}, week };
    }
};