import { get } from 'svelte/store';
import { leagueData } from '$lib/stores';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { fetchAndNormalizeYahooLeague } from '../yahooService';
import { fetchAndNormalizeESPNLeague } from '../espnService';
import { isYahooLeagueId, isEspnLeagueId } from '../platformIds';

export const getLeagueData = async (queryLeagueID, passedUserId = null) => {
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
    if (isYahooLeagueId(id)) {
        const yData = await fetchAndNormalizeYahooLeague(id);
        if (yData) {
            leagueData.update(ld => { ld[id] = yData; return ld; });
            return yData;
        }
        return null;
    }

    // --- ESPN PLATFORM ROUTING ---
    // Checked explicitly by its "espn:" prefix rather than falling into the
    // Sleeper branch below: an ESPN league id is a plain number, exactly the
    // shape a Sleeper id has, so treating "not Yahoo" as "must be Sleeper"
    // used to send ESPN's numeric id to Sleeper's API -- which, if that
    // number happened to also be a real Sleeper league's id, would silently
    // show that unrelated league's data with no indication anything was wrong.
    if (isEspnLeagueId(id)) {
        try {
            const eData = await fetchAndNormalizeESPNLeague(id, {}, passedUserId);
            if (eData) {
                leagueData.update(ld => { ld[id] = eData; return ld; });
                return eData;
            }
        } catch (e) {
            console.error("ESPN League Data Fetch Failed", e);
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