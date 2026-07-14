import { getLeagueData } from "./leagueData"
import { getNflState } from "./nflState"
import { getLeagueTeamManagers } from "./leagueTeamManagers";
import { getRosterIDFromManagerIDAndYear } from '$lib/utils/helperFunctions/universalFunctions';
import { get } from 'svelte/store';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';

export const getRivalryMatchups = async (userOneID, userTwoID) => {
    if(!userOneID || !userTwoID) return null;
    
    const activeStore = get(activeLeague);
    let curLeagueID = activeStore?.sleeper_league_id || defaultLeagueID;

    try {
        const [nflState, teamManagers] = await Promise.all([
            getNflState(),
            getLeagueTeamManagers(),
        ]);

        let week = 1;
        if(nflState.season_type === 'regular') week = nflState.display_week;
        else if(nflState.season_type === 'post') week = 18;

        const rivalry = { points: { one: 0, two: 0 }, wins: { one: 0, two: 0 }, ties: 0, matchups: [] }

        while(curLeagueID && curLeagueID !== 0 && curLeagueID !== "0") {
            const leagueData = await getLeagueData(curLeagueID);
            if(!leagueData) break;

            const year = leagueData.season;
            const rosterIDOne = getRosterIDFromManagerIDAndYear(teamManagers, userOneID, year);
            const rosterIDTwo = getRosterIDFromManagerIDAndYear(teamManagers, userTwoID, year);

            if(!rosterIDOne || !rosterIDTwo || rosterIDOne === rosterIDTwo) {
                curLeagueID = leagueData.previous_league_id;
                week = 18;
                continue;
            }

            const matchupsPromises = [];
            for(let i = 1; i < (leagueData.settings?.playoff_week_start || 15); i++) {
                matchupsPromises.push(fetch(`https://api.sleeper.app/v1/league/${curLeagueID}/matchups/${i}`, {compress: true}))
            }
            const matchupsRes = await Promise.all(matchupsPromises);
            const matchupsData = await Promise.all(matchupsRes.map(r => r.json()));

            for(let i = 1; i < matchupsData.length + 1; i++) {
                const processed = processRivalryMatchups(matchupsData[i - 1], i, rosterIDOne, rosterIDTwo);
                if(processed) {
                    const {matchup, week} = processed;
                    const sideA = matchup[0];
                    const sideB = matchup[1];
                    let sideAPoints = sideA.points.reduce((t, nV) => t + nV, 0);
                    let sideBPoints = sideB.points.reduce((t, nV) => t + nV, 0);
                    rivalry.points.one += sideAPoints;
                    rivalry.points.two += sideBPoints;
                    
                    if(sideAPoints > sideBPoints) rivalry.wins.one++;
                    else if(sideAPoints < sideBPoints) rivalry.wins.two++;
                    else rivalry.ties++;
                    
                    rivalry.matchups.push({ week, year, matchup })
                }
            }
            curLeagueID = leagueData.previous_league_id;
            week = 18;
        }

        rivalry.matchups.sort((a, b) => (b.year - a.year) || (b.week - a.week));
        return rivalry;
    } catch (e) {
        console.error("Rivalry fetch broke", e);
        return null;
    }
}

const processRivalryMatchups = (inputMatchups, week, rosterIDOne, rosterIDTwo) => {
    if(!inputMatchups || inputMatchups.length === 0) return false;
    const matchups = {};
    for(const match of inputMatchups) {
        if(match.roster_id == rosterIDOne || match.roster_id == rosterIDTwo) {
            if(!matchups[match.matchup_id]) matchups[match.matchup_id] = [];
            matchups[match.matchup_id].push({
                roster_id: match.roster_id,
                starters: match.starters || [],
                points: match.starters_points || [],
            })
        }
    }
    const keys = Object.keys(matchups);
    if(keys.length === 0) return false;
    const matchup = matchups[keys[0]];
    if(keys.length > 1 || matchup.length === 1) return false;
    if(matchup[0].roster_id == rosterIDTwo) matchup.push(matchup.shift());
    return {matchup, week};
}
