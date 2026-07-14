import { get } from 'svelte/store';
import { players } from '$lib/stores';
import { browser } from '$app/environment';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';

export const loadPlayers = async (servFetch, refresh = false) => {
    const activeStore = get(activeLeague);
    const currentId = activeStore?.sleeper_league_id || defaultLeagueID;

    // Use current runtime memory if already loaded to save browser disk space
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
        const data = await res.json();
        
        if (!res.ok) throw new Error("API unreachable");
        
        if(browser) {
            try {
                // If disk space is full, do not crash the app. Fallback to runtime memory.
                localStorage.setItem(`playersInfo_${currentId}`, JSON.stringify(data));
                localStorage.setItem(`expiration_${currentId}`, (now + (24 * 3600)).toString());
            } catch (storageError) {
                console.warn("Storage limits exceeded. Wiping old cache strings to clear space.", storageError);
                
                // Clear previous unneeded player caches to free up browser disk blocks
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.startsWith('playersInfo_') || key.startsWith('expiration_'))) {
                        localStorage.removeItem(key);
                    }
                }
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