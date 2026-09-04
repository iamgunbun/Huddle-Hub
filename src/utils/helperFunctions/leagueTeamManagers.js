import { get } from 'svelte/store';
import { teamManagersStore } from '$lib/stores';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { getManagers, getTeamData } from './universalFunctions';
import { getLeagueData } from './leagueData';
import { getLeagueRosters } from './leagueRosters';
import { isSameLeagueChain } from '../yahooHistory';

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

    // Native Yahoo Handling -- walks the "renew" chain (via previous_league_id)
    // the same way the Sleeper branch below walks previous_league_id, so past
    // seasons' teams/managers show up instead of just the current season.
    if (id && (String(id).includes('.') || !/^\d+$/.test(String(id)))) {
        let currentLeagueID = id;
        const teamManagersMap = {};
        const finalUsers = {};
        let currentSeason = null;
        const visited = new Set();
        let successor = null;

        while (currentLeagueID && currentLeagueID !== 0 && currentLeagueID !== "0" && !visited.has(currentLeagueID)) {
            visited.add(currentLeagueID);
            try {
                const [leagueData, rostersData] = await Promise.all([
                    getLeagueData(currentLeagueID),
                    // Only team names, avatars and managers are needed here, so
                    // skip the per-team player fetch for every past season.
                    getLeagueRosters(currentLeagueID, { teamsOnly: true }),
                ]);
                if (!leagueData || !rostersData) break;

                // Same guard the records and trophy-room walks use: a bad renew
                // pointer would otherwise list another league's teams as this
                // league's past seasons.
                if (successor && !isSameLeagueChain(leagueData, successor)) {
                    console.warn(`Stopping the Yahoo season walk at "${currentLeagueID}": it isn't "${successor.league_id}"'s previous season.`);
                    break;
                }
                successor = leagueData;

                const year = parseInt(leagueData.season) || new Date().getFullYear();
                if (!currentSeason) currentSeason = year;
                teamManagersMap[year] = {};

                Object.values(rostersData.rosters || {}).forEach(roster => {
                    // owner_id is the manager's Yahoo guid (stable across
                    // seasons), not the season-scoped team key -- that's what
                    // lets all-time records, rivalries and the trophy room
                    // recognise the same person from one year to the next.
                    const managers = getManagers(roster);
                    teamManagersMap[year][roster.roster_id] = {
                        team: {
                            name: roster.team_name || `Team ${roster.roster_id}`,
                            avatar: roster.avatar || '/brand.png'
                        },
                        managers
                    };
                    managers.forEach(managerID => {
                        if (!finalUsers[managerID]) {
                            finalUsers[managerID] = {
                                display_name: roster.manager_name || roster.team_name,
                                avatar: roster.avatar || '/brand.png',
                                user_id: managerID
                            };
                        }
                    });
                });

                currentLeagueID = leagueData.previous_league_id || 0;
            } catch (e) {
                console.error("Yahoo team managers fetch broke for ID", currentLeagueID, e);
                break;
            }
        }

        const response = { teamManagersMap, users: finalUsers, currentSeason, league_id: id };
        teamManagersStore.update(() => response);
        return response;
    }

    // Sleeper Handling
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
    };
    teamManagersStore.update(() => response);
    return response;
};