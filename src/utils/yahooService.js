// src/utils/yahooService.js

export const fetchAndNormalizeYahooLeague = async (leagueId, userId) => {
    if (!leagueId || !userId) return null;

    try {
        const response = await fetch('/api/yahoo-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId, 
                endpoint: `league/nfl.l.${leagueId};out=settings` 
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server responded with status ${response.status}`);
        }

        const data = await response.json();
        
        // Navigate Yahoo's JSON structure
        const leagueData = data?.fantasy_content?.league?.[0];
        
        if (!leagueData) {
            throw new Error("Invalid Yahoo league data returned.");
        }

        const leagueName = leagueData.name || `Yahoo League ${leagueId}`;
        const totalRosters = leagueData.num_teams || 10;
        const avatar = leagueData.logo_url || '/brand.png';

        return {
            id: String(leagueId),
            sleeper_league_id: String(leagueId),
            name: leagueName,
            platform: 'yahoo',
            total_rosters: totalRosters,
            settings: {
                type: 0 
            },
            avatar: avatar,
            raw_yahoo: data
        };

    } catch (error) {
        console.error("Yahoo Adapter Error:", error);
        throw error;
    }
};