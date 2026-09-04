import { getLeagueData } from './leagueData';
import { getLeagueRosters } from './leagueRosters';
import { waitForAll } from './multiPromise';
import { fetchYahooStandings } from '../yahooService';
import { buildPodiumFromStandings, isSameLeagueChain } from '../yahooHistory';

const isYahooLeague = (id) => !!id && (String(id).includes('.') || !/^\d+$/.test(String(id)));

let awardsCache = [];
let awardsCacheLeagueID = null;

export const getAwards = async (refresh = false, queryLeagueID = null) => {
    if (queryLeagueID) refresh = true;

    if (!refresh && awardsCache.length && awardsCacheLeagueID === queryLeagueID) {
        return awardsCache;
    }

    // Keyed per league: a single shared "awards" key meant one league's trophy
    // room could be served to another (and a Yahoo podium to a Sleeper league).
    const cacheKey = `awards_${queryLeagueID || 'default'}`;

    // The old shared key is dead weight now, and localStorage is tight enough
    // here that a stale multi-megabyte-adjacent leftover matters.
    if (typeof window !== 'undefined') {
        try { localStorage.removeItem("awards"); } catch { /* nothing to clean up */ }
    }

    if (!refresh && typeof window !== 'undefined') {
        let localAwards = await JSON.parse(localStorage.getItem(cacheKey));
        if (localAwards && localAwards.length > 0) {
            awardsCache = localAwards;
            awardsCacheLeagueID = queryLeagueID;
            return localAwards;
        }
    }

    const leagueData = await getLeagueData(queryLeagueID).catch((err) => { console.error(err); });
    if (!leagueData) return [];

    const startingSeasonID = leagueData.status === "complete"
        ? (leagueData.league_id || queryLeagueID)
        : leagueData.previous_league_id;

    const podiums = isYahooLeague(leagueData.league_id || queryLeagueID)
        ? await getYahooPodiums(startingSeasonID)
        : await getPodiums(startingSeasonID);

    awardsCache = podiums;
    awardsCacheLeagueID = queryLeagueID;
    if (typeof window !== 'undefined') {
        try {
            localStorage.setItem(cacheKey, JSON.stringify(podiums));
        } catch (e) {
            console.warn("Awards cache skipped:", e);
        }
    }
    return podiums;
};

// Yahoo has no winners/losers bracket endpoint, so a season's podium comes from
// its FINAL standings instead: once Yahoo reports the season finished, rank 1 is
// the champion, 2 the runner-up, 3 third place. Unfinished seasons are skipped
// -- their ranks are just the current standings and would crown a champion in
// October.
const getYahooPodiums = async (startingSeasonID) => {
    const podiums = [];
    let seasonID = startingSeasonID;
    const visited = new Set();
    let successor = null;

    while (seasonID && seasonID !== 0 && seasonID !== "0" && !visited.has(seasonID)) {
        visited.add(seasonID);

        const seasonData = await getLeagueData(seasonID).catch((err) => { console.error(err); return null; });
        if (!seasonData) break;

        // Same guard as the records walk: don't crown another league's champion.
        if (successor && !isSameLeagueChain(seasonData, successor)) {
            console.warn(`Stopping the trophy-room walk at "${seasonID}": it isn't "${successor.league_id}"'s previous season.`);
            break;
        }
        successor = seasonData;

        if (seasonData.status === 'complete') {
            const standings = await fetchYahooStandings(seasonID).catch((err) => { console.error(err); return []; });
            const podium = buildPodiumFromStandings(standings, parseInt(seasonData.season));
            if (podium) podiums.push(podium);
        }

        seasonID = seasonData.previous_league_id || 0;
    }

    return podiums;
};

const getPodiums = async (previousSeasonID) => {
    const podiums = [];
    
    while (previousSeasonID && previousSeasonID !== 0 && previousSeasonID !== "0") {
        const previousSeasonData = await getPreviousLeagueData(previousSeasonID);
        if (!previousSeasonData) break;
        
        const { losersData, winnersData, year, previousRosters, numDivisions, playoffRounds, toiletRounds, leagueMetadata } = previousSeasonData;
        previousSeasonID = previousSeasonData.previousSeasonID;

        const divisions = buildDivisionsAndManagers({previousRosters, leagueMetadata, numDivisions});
        const divisionArr = [];
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
        };
        podiums.push(podium);
    }
    return podiums;
};

const getPreviousLeagueData = async (previousSeasonID) => {
    if (!previousSeasonID || String(previousSeasonID).includes('.') || !/^\d+$/.test(String(previousSeasonID))) {
        return null;
    }

    const resPromises = [
        fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}`, {compress: true}),
        getLeagueRosters(previousSeasonID),
        fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}/losers_bracket`, {compress: true}),
        fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}/winners_bracket`, {compress: true}),
    ];

    const [leagueRes, rostersData, losersRes, winnersRes] = await waitForAll(...resPromises).catch((err) => { console.error(err); return []; });

    if(!leagueRes?.ok || !losersRes?.ok || !winnersRes?.ok) {
        return null;
    }

    const jsonPromises = [
        leagueRes.json(),
        losersRes.json(),
        winnersRes.json(),
    ];

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
    };
};

const buildDivisionsAndManagers = ({previousRosters, leagueMetadata, numDivisions}) => {
    const divisions = {};
    for(let i = 1; i <= numDivisions; i++) {
        divisions[i] = {
            name: leagueMetadata ? leagueMetadata[`division_${i}`] : null,
            wins: -1,
            points: -1
        };
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
};