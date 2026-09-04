import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { fetchAndNormalizeYahooRosters, fetchYahooSeasonTeams } from '../yahooService';

const isYahooLeague = (id) => id && (String(id).includes('.') || !/^\d+$/.test(String(id)));

// Seasons already resolved by a teams-only (standings) fetch. Kept apart from
// rostersStore on purpose: these entries have no player lists, so they must
// never be served to a caller that asked for full rosters.
const seasonTeamsCache = {};

/**
 * @param {object} [options]
 * @param {boolean} [options.teamsOnly] Skip the per-team player fetches. The
 *   history pages (records, trophy room, managers) only need each team's
 *   record, name and manager, and fetching players for every past season costs
 *   one Yahoo proxy call per team per season.
 */
export const getLeagueRosters = async (queryLeagueID = defaultLeagueID, { teamsOnly = false } = {}) => {
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
        if (teamsOnly) {
            if (seasonTeamsCache[queryLeagueID]) return seasonTeamsCache[queryLeagueID];
            const yTeams = await fetchYahooSeasonTeams(queryLeagueID);
            if (Object.keys(yTeams.rosters).length > 0) seasonTeamsCache[queryLeagueID] = yTeams;
            return yTeams;
        }

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