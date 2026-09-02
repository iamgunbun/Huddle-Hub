import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { fetchAndNormalizeYahooRosters } from '../yahooService';

const isYahooLeague = (id) => id && (String(id).includes('.') || !/^\d+$/.test(String(id)));

export const getLeagueRosters = async (queryLeagueID = defaultLeagueID) => {
    if (!queryLeagueID) return { rosters: {}, startersAndReserve: [] };

    const storedRoster = get(rostersStore)?.[queryLeagueID];

    if (
        storedRoster 
        && typeof storedRoster.rosters === 'object' && 
        !Array.isArray(storedRoster.rosters) && 
        storedRoster.rosters !== null
    ) {
        return storedRoster;
    }

    // --- YAHOO PLATFORM ROUTING ---
    if (isYahooLeague(queryLeagueID)) {
        const yRosters = await fetchAndNormalizeYahooRosters(queryLeagueID);
        if (yRosters && Object.keys(yRosters.rosters).length > 0) {
            rostersStore.update(r => { r[queryLeagueID] = yRosters; return r; });
            return yRosters;
        }
        return yRosters;
    }

    // --- SLEEPER PLATFORM ROUTING ---
    try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, { compress: true });
        const data = await res.json();
        
        if (res.ok) {
            const processedRosters = processRosters(data);
            rostersStore.update(r => { r[queryLeagueID] = processedRosters; return r; });
            return processedRosters;
        } else {
            throw new Error(data);
        }
    } catch (err) {
        console.error("Rosters Fetch Failed:", err);
        return { rosters: {}, startersAndReserve: [] };
    }
};

const processRosters = (rosters) => {
    const startersAndReserve = [];
    const rosterMap = {};

    if (!Array.isArray(rosters)) return { rosters: rosterMap, startersAndReserve };

    for (const roster of rosters) {
        if (roster.starters && Array.isArray(roster.starters)) {
            for (const starter of roster.starters) {
                startersAndReserve.push(starter);
            }
        }
        if (roster.reserve && Array.isArray(roster.reserve)) {
            for (const ir of roster.reserve) {
                startersAndReserve.push(ir);
            }
        }
        rosterMap[roster.roster_id] = roster;
    }

    return { rosters: rosterMap, startersAndReserve };
};