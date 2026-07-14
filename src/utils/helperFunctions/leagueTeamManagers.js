import { get } from 'svelte/store';
import { teamManagersStore } from '$lib/stores';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { getManagers, getTeamData } from './universalFunctions';
import { getLeagueData } from './leagueData';

export const getLeagueTeamManagers = async (queryLeagueID) => {
    let id = queryLeagueID;
    if (!id) {
        const activeStore = get(activeLeague);
        id = activeStore?.sleeper_league_id || defaultLeagueID;
    }

    const store = get(teamManagersStore);
    if(store && store.currentSeason && store.league_id === id) {
        return store;
    }

    let currentLeagueID = id;
    let teamManagersMap = {};
    let finalUsers = {};
    let currentSeason = null;

    while(currentLeagueID && currentLeagueID !== 0 && currentLeagueID !== "0") {
        try {
            const [usersRaw, leagueData, rostersRaw] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${currentLeagueID}/users`, {compress: true}),
                getLeagueData(currentLeagueID),
                fetch(`https://api.sleeper.app/v1/league/${currentLeagueID}/rosters`, {compress: true}),
            ]);

            if(!usersRaw.ok || !rostersRaw.ok || !leagueData) break;

            const users = await usersRaw.json();
            const rosters = await rostersRaw.json();

            const year = parseInt(leagueData.season);
            currentLeagueID = leagueData.previous_league_id;

            if(!currentSeason) currentSeason = year;

            teamManagersMap[year] = {};
            
            let finalUsersObj = {};
            for(const user of users) {
                user.display_name = user.display_name ?? user.user_name;
                finalUsersObj[user.user_id] = user;
                if(!finalUsers[user.user_id]) {
                    finalUsers[user.user_id] = user;
                }
            }

            for(const roster of rosters) {
                teamManagersMap[year][roster.roster_id] = {
                    team: getTeamData(finalUsersObj, roster.owner_id),
                    managers: getManagers(roster, finalUsersObj),
                };
            }
        } catch (e) {
            console.error("Team managers fetch broke for ID", currentLeagueID, e);
            break;
        }
    }

    const response = {
        currentSeason,
        teamManagersMap,
        users: finalUsers,
        league_id: id 
    }

    teamManagersStore.update(() => response);
    return response;
}