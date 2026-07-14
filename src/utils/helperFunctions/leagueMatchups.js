import { getLeagueData } from "./leagueData"
import { getNflState } from "./nflState"
import { get } from 'svelte/store';
import { matchupsStore } from '$lib/stores';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';

export const getLeagueMatchups = async (queryLeagueID) => {
    let id = queryLeagueID;
    if (!id) {
        const activeStore = get(activeLeague);
        id = activeStore?.sleeper_league_id || defaultLeagueID;
    }

    const store = get(matchupsStore);
    if(store && store.matchupWeeks && store.league_id === id) {
        return store;
    }

    try {
        const [nflState, leagueData] = await Promise.all([
            getNflState(),
            getLeagueData(id),
        ]);

        if (!leagueData) return null;

        let week = 1;
        if(nflState.season_type === 'regular') {
            week = nflState.display_week;
        } else if(nflState.season_type === 'post') {
            week = 18;
        }

        const year = leagueData.season;
        const regularSeasonLength = leagueData.settings?.playoff_week_start ? leagueData.settings.playoff_week_start - 1 : 14;
        const maxWeeks = leagueData.settings?.playoff_week_start || 15;

        const matchupsPromises = [];
        for(let i = 1; i < maxWeeks; i++) {
            matchupsPromises.push(fetch(`https://api.sleeper.app/v1/league/${id}/matchups/${i}`, {compress: true}))
        }

        const matchupsRes = await Promise.all(matchupsPromises);
        const matchupsData = await Promise.all(matchupsRes.map(res => res.json()));

        const matchupWeeks = [];
        for(let i = 1; i < matchupsData.length + 1; i++) {
            const processed = processMatchups(matchupsData[i - 1], i);
            if(processed) {
                matchupWeeks.push({
                    matchups: processed.matchups,
                    week: processed.week
                });
            }
        }

        const matchupsResponse = {
            matchupWeeks,
            year,
            week,
            regularSeasonLength,
            league_id: id
        }

        matchupsStore.update(() => matchupsResponse);
        return matchupsResponse;

    } catch (e) {
        console.error("Matchups failed to load completely: ", e);
        return null;
    }
}

const processMatchups = (inputMatchups, week) => {
    if(!inputMatchups || inputMatchups.length === 0) return false;
    const matchups = {};
    for(const match of inputMatchups) {
        if(!matchups[match.matchup_id]) matchups[match.matchup_id] = [];
        matchups[match.matchup_id].push({
            roster_id: match.roster_id,
            starters: match.starters || [],
            points: match.starters_points || [],
        })
    }
    return {matchups, week};
}