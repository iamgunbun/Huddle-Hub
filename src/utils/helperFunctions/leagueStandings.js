import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { getNflState } from "./nflState";
import { getLeagueData } from "./leagueData";
import { getLeagueRosters } from "./leagueRosters";
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { standingsStore } from '$lib/stores';
import { round } from './universalFunctions';

export const getLeagueStandings = async (queryLeagueID = null) => {
    let id = queryLeagueID;
    if (!id) {
        id = defaultLeagueID;
    }

    const store = get(standingsStore);
    if(store && store.standingsInfo && store.league_id === id) {
        return store;
    }

    const [nflState, leagueData, rostersData] = await waitForAll(
        getNflState(),
        getLeagueData(id),
        getLeagueRosters(id),
    ).catch((err) => { console.error(err); });

    if (!leagueData || !rostersData) return null;

    const yearData = leagueData.season;
    const rosters = rostersData.rosters || {};

    let standings = {};
    for(const rosterID in rosters) {
        const roster = rosters[rosterID];
        const settings = roster.settings || {};
        standings[rosterID] = {
            rosterID,
            wins: settings.wins || 0,
            losses: settings.losses || 0,
            ties: settings.ties || 0,
            fpts: round((settings.fpts || 0) + ((settings.fpts_decimal || 0) / 100)),
            fptsAgainst: round((settings.fpts_against || 0) + ((settings.fpts_against_decimal || 0) / 100)),
            streak: roster.metadata?.streak || 0,
            divisionWins: null,
            divisionLosses: null,
            divisionTies: null,
        }
    }

    const response = {
        standingsInfo: standings,
        yearData,
        league_id: id
    }
    
    standingsStore.update(() => response);

    return response;
}