// src/utils/espnService.js
import { supabase } from '../supabaseClient';
import { fromEspnLeagueId } from './platformIds';

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

    try {
        const CURRENT_YEAR = new Date().getFullYear();
        const cleanId = fromEspnLeagueId(leagueId).trim();
        const resolvedUserId = await getUserId(userId);

        // PING YOUR OWN SECURE BACKEND INSTEAD OF ESPN
        const response = await fetch('/api/espn-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                leagueId: cleanId,
                year: CURRENT_YEAR,
                espnS2: cookies?.espn_s2,
                swid: cookies?.swid,
                userId: resolvedUserId
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