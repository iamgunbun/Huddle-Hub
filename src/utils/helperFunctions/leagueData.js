import { get } from 'svelte/store';
import { leagueData } from '$lib/stores';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';

export const getLeagueData = async (queryLeagueID) => {
    let id = queryLeagueID;
    if (!id) {
        const activeStore = get(activeLeague);
        id = activeStore?.sleeper_league_id || defaultLeagueID;
    }

    if(get(leagueData)[id]) {
        return get(leagueData)[id];
    }

    try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${id}`, {compress: true});
        const data = await res.json();
        
        if (res.ok) {
            leagueData.update(ld => {ld[id] = data; return ld});
            return data;
        } else {
            console.error("League Data Error", data);
            return null;
        }
    } catch (e) {
        console.error("League Data Fetch Failed", e);
        return null;
    }
}