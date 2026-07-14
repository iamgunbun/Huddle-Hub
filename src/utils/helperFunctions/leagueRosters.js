import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';

export const getLeagueRosters = async (queryLeagueID = defaultLeagueID) => {
    const storedRoster = get(rostersStore)[queryLeagueID];

    if(
        storedRoster 
        && typeof storedRoster.rosters === 'object' && 
        !Array.isArray(storedRoster.rosters) && 
        storedRoster.rosters !== null
    ) {
        return storedRoster;
    }

    const res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, {compress: true}).catch((err) => { console.error(err); });
    const data = await res.json().catch((err) => { console.error(err); });
    
    if (res.ok) {
        const processedRosters = processRosters(data);
        rostersStore.update(r => {r[queryLeagueID] = processedRosters; return r});
        return processedRosters;
    } else {
        throw new Error(data);
    }
}

const processRosters = (rosters) => {
    const startersAndReserve = [];
    const rosterMap = {};

    for(const roster of rosters) {
        // FIXED: Hard safety check to prevent pre-draft league crashing
        if(roster.starters && Array.isArray(roster.starters)) {
            for(const starter of roster.starters) {
                startersAndReserve.push(starter);
            }
        }
        if(roster.reserve && Array.isArray(roster.reserve)) {
            for(const ir of roster.reserve) {
                startersAndReserve.push(ir);
            }
        }
        rosterMap[roster.roster_id] = roster;
    }

    return {rosters: rosterMap, startersAndReserve};
}