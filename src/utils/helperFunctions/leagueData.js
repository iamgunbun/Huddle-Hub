import { get } from 'svelte/store';
import { leagueData } from '$lib/stores';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { fetchAndNormalizeYahooLeague } from '../yahooService';

const isYahooLeague = (id) => id && (String(id).includes('.') || !/^\d+$/.test(String(id)));

export const getLeagueData = async (queryLeagueID) => {
    let id = queryLeagueID;
    if (!id) {
        const activeStore = get(activeLeague);
        id = activeStore?.sleeper_league_id || defaultLeagueID;
    }

    if (!id) return null;

    if (get(leagueData)?.[id]) {
        return get(leagueData)[id];
    }

    // --- YAHOO PLATFORM ROUTING ---
    if (isYahooLeague(id)) {
        const yData = await fetchAndNormalizeYahooLeague(id);
        if (yData) {
            leagueData.update(ld => { ld[id] = yData; return ld; });
            return yData;
        }
        return null;
    }

    // --- SLEEPER PLATFORM ROUTING ---
    try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${id}`, { compress: true });
        const data = await res.json();
        
        if (res.ok) {
            leagueData.update(ld => { ld[id] = data; return ld; });
            return data;
        } else {
            console.error("League Data Error", data);
            return null;
        }
    } catch (e) {
        console.error("League Data Fetch Failed", e);
        return null;
    }
};