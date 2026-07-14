import { getLeagueData } from './leagueData';
import { getLeagueRosters } from './leagueRosters';
import { waitForAll } from './multiPromise';

let awardsCache = [];

export const getAwards = async (refresh = false, queryLeagueID = null) => {
    if (queryLeagueID) refresh = true;

    if (!refresh && awardsCache.length) {
        return awardsCache;
    }

    if (!refresh && typeof window !== 'undefined') {
        let localAwards = await JSON.parse(localStorage.getItem("awards"));
        if (localAwards && localAwards.length > 0) {
            awardsCache = localAwards;
            return localAwards;
        }
    }
    
    const leagueData = await getLeagueData(queryLeagueID).catch((err) => { console.error(err); });
    if (!leagueData) return [];
    
    let previousSeasonID = leagueData.status === "complete" ? leagueData.league_id : leagueData.previous_league_id;
    
    const podiums = await getPodiums(previousSeasonID);
    awardsCache = podiums;
    if (typeof window !== 'undefined') {
        localStorage.setItem("awards", JSON.stringify(podiums));
    }
    return podiums;
}

const getPodiums = async (previousSeasonID) => {
    const podiums = [];
    
    // CRITICAL FIX: Safe check for string "0"
    while (previousSeasonID && previousSeasonID !== 0 && previousSeasonID !== "0") {
        const previousSeasonData = await getPreviousLeagueData(previousSeasonID);
        if (!previousSeasonData) break;
        
        const { losersData, winnersData, year, previousRosters, numDivisions, playoffRounds, toiletRounds, leagueMetadata } = previousSeasonData;
        previousSeasonID = previousSeasonData.previousSeasonID;

        const divisions = buildDivisionsAndManagers({previousRosters, leagueMetadata, numDivisions});
        const divisionArr = []
        for(const key in divisions) {
            divisionArr.push(divisions[key]);
        }

        const finalsMatch = winnersData?.filter(m => m.r == playoffRounds && m.t1_from?.w)[0];
        const champion = finalsMatch?.w;
        const second = finalsMatch?.l;

        const runnersUpMatch = winnersData?.filter(m => m.r == playoffRounds && m.t1_from?.l)[0];
        const third = runnersUpMatch?.w;

        const toiletBowlMatch = losersData?.filter(m => m.r == toiletRounds && (!m.t1_from || m.t1_from?.w))[0];
        const toilet = toiletBowlMatch?.w;

        if(!champion) continue;

        const podium = {
            year,
            champion,
            second,
            third,
            divisions: divisionArr,
            toilet
        }
        podiums.push(podium);
    }
    return podiums;
}

const getPreviousLeagueData = async (previousSeasonID) => {
    const resPromises = [
        fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}`, {compress: true}),
        getLeagueRosters(previousSeasonID),
        fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}/losers_bracket`, {compress: true}),
        fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}/winners_bracket`, {compress: true}),
    ]

    const [leagueRes, rostersData, losersRes, winnersRes] = await waitForAll(...resPromises).catch((err) => { console.error(err); return []; });

    if(!leagueRes?.ok || !losersRes?.ok || !winnersRes?.ok) {
        return null;
    }

    const jsonPromises = [
        leagueRes.json(),
        losersRes.json(),
        winnersRes.json(),
    ]

    const [prevLeagueData, losersData, winnersData] = await waitForAll(...jsonPromises).catch((err) => { console.error(err); return []; });

    const year = prevLeagueData.season;
    const previousRosters = rostersData.rosters;
    const numDivisions = prevLeagueData.settings.divisions || 1;
    const prevId = prevLeagueData.previous_league_id;

    const playoffRounds = winnersData && winnersData.length > 0 ? winnersData[winnersData.length - 1].r : 3;
    const toiletRounds = losersData && losersData.length > 0 ? losersData[losersData.length - 1].r : 3;

    return {
        losersData,
        winnersData,
        year,
        previousRosters,
        numDivisions,
        previousSeasonID: prevId,
        playoffRounds,
        toiletRounds,
        leagueMetadata: prevLeagueData.metadata
    }
}

const buildDivisionsAndManagers = ({previousRosters, leagueMetadata, numDivisions}) => {
    const divisions = {};
    for(let i = 1; i <= numDivisions; i++) {
        divisions[i] = {
            name: leagueMetadata ? leagueMetadata[`division_${i}`] : null,
            wins: -1,
            points: -1
        }
    }

    for(const rosterID in previousRosters) {
        const rSettings = previousRosters[rosterID].settings;
        const div = !rSettings.division || rSettings.division > numDivisions ? 1 : rSettings.division;
        
        if(rSettings.wins > divisions[div].wins || (rSettings.wins == divisions[div].wins && (rSettings.fpts  + rSettings.fpts_decimal / 100)  == divisions[div].points)) {
            divisions[div].points = rSettings.fpts  + rSettings.fpts_decimal / 100;
            divisions[div].wins = rSettings.wins;
            divisions[div].rosterID = rosterID;
        }
    }
    return divisions;
}