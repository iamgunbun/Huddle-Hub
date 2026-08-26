// src/utils/espnService.js

export const fetchAndNormalizeESPNLeague = async (leagueId, cookies = {}) => {
    if (!leagueId) return null;

    try {
        const CURRENT_YEAR = new Date().getFullYear();
        const cleanId = String(leagueId).trim();
        
        // PING YOUR OWN SECURE BACKEND INSTEAD OF ESPN
        const response = await fetch('/api/espn-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                leagueId: cleanId,
                year: CURRENT_YEAR,
                espnS2: cookies?.espn_s2,
                swid: cookies?.swid
            })
        });

        if (response.status === 401) {
            throw new Error("Private ESPN League: Please provide valid espn_s2 and SWID cookies.");
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server responded with status ${response.status}`);
        }

        const data = await response.json();

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

        return {
            id: String(cleanId),
            sleeper_league_id: String(cleanId), // Maintains UI routing compatibility
            name: leagueName,
            platform: 'espn',
            total_rosters: totalRosters,
            settings: {
                type: leagueType
            },
            avatar: avatar,
            raw_espn: data
        };
    } catch (error) {
        console.error("ESPN Adapter Error:", error);
        throw error;
    }
};