import { get } from 'svelte/store';
import { players } from '$lib/stores';
import { browser } from '$app/environment';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';

export const loadPlayers = async (servFetch, refresh = false) => {
    const activeStore = get(activeLeague);
    const currentId = activeStore?.sleeper_league_id || defaultLeagueID;

    if(get(players) && get(players)[1426] && !refresh) {
        return {
            players: get(players),
            stale: false
        };
    }
    
    const smartFetch = servFetch ?? fetch;
    const now = Math.round(new Date().getTime() / 1000);
    
    let playersInfo = null;
    let expiration = null;
    
    if(browser) {
        try {
            playersInfo = JSON.parse(localStorage.getItem(`playersInfo_${currentId}`));
            expiration = parseInt(localStorage.getItem(`expiration_${currentId}`));
        } catch (e) {
            console.warn("Failed to read local player cache safely:", e);
        }
    }

    if(playersInfo && playersInfo[1426] && expiration && now < expiration && !refresh) {
        players.update(() => playersInfo);
        return {
            players: playersInfo,
            stale: false
        };
    }

    try {
        const res = await smartFetch(`/api/fetch_players_info?league=${currentId}`, {compress: true});
        const contentType = res.headers.get("content-type");
        
        let data;
        
        if (res.ok && contentType && contentType.includes("application/json")) {
            data = await res.json();
        } else {
            console.warn("Local API missing. Rebuilding Player & Projections Data from Sleeper API...");
            
            // 1. Fetch raw player list & League Scoring Settings
            const [sleeperRes, leagueRes] = await Promise.all([
                fetch("https://api.sleeper.app/v1/players/nfl"),
                fetch(`https://api.sleeper.app/v1/league/${currentId}`)
            ]);
            
            const rawPlayers = await sleeperRes.json();
            const leagueData = await leagueRes.json();
            const scoringSettings = leagueData.scoring_settings || {};
            
            // 2. Fetch the active NFL State to determine the current week
            const stateRes = await fetch("https://api.sleeper.app/v1/state/nfl");
            const nflState = await stateRes.json();
            const week = nflState.display_week > 0 ? nflState.display_week : 1;
            const year = nflState.season || new Date().getFullYear();

            // 3. Fetch Live Projections
            const projRes = await fetch(`https://api.sleeper.com/projections/nfl/${year}/${week}?season_type=regular`);
            const projections = await projRes.json();

            // 4. Calculate Custom Projections based on League Settings
            const projMap = {};
            if (projections && projections.length) {
                for (const proj of projections) {
                    let customPoints = 0;
                    if (proj.stats) {
                        for (const [statKey, statValue] of Object.entries(proj.stats)) {
                            if (scoringSettings[statKey]) {
                                customPoints += statValue * scoringSettings[statKey];
                            }
                        }
                    }
                    projMap[proj.player_id] = customPoints;
                }
            }
            
            // 5. Compress to prevent Quota crashes
            data = {};
            for (const id in rawPlayers) {
                const p = rawPlayers[id];
                if (!p) continue;
                
                data[id] = {
                    fn: p.first_name,
                    ln: p.last_name,
                    pos: p.position,
                    t: p.team || 'FA',
                    wi: {}
                };

                if (projMap[id] !== undefined) {
                    data[id].wi[week] = { p: projMap[id] };
                }
            }
        }
        
        if(browser) {
            try {
                localStorage.setItem(`playersInfo_${currentId}`, JSON.stringify(data));
                localStorage.setItem(`expiration_${currentId}`, (now + (24 * 3600)).toString());
            } catch (storageError) {
                console.warn("Storage limits exceeded. Wiping old cache strings to clear space.");
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.startsWith('playersInfo_') || key.startsWith('expiration_'))) {
                        localStorage.removeItem(key);
                    }
                }
                try {
                    localStorage.setItem(`playersInfo_${currentId}`, JSON.stringify(data));
                    localStorage.setItem(`expiration_${currentId}`, (now + (24 * 3600)).toString());
                } catch(e) {}
            }
        }

        players.update(() => data);
        return {
            players: data,
            stale: false
        };
    } catch (e) {
        console.error("Player background fetch failed, using memory fallback:", e);
        return {
            players: playersInfo || get(players) || {},
            stale: false
        };
    }
}