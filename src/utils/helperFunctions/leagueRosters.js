import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { fetchAndNormalizeYahooRosters, fetchYahooSeasonTeams } from '../yahooService';
import { fetchAndNormalizeESPNRosters } from '../espnService';
import { isYahooLeagueId as isYahooLeague, isEspnLeagueId } from '../platformIds';

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

    // --- ESPN PLATFORM ROUTING ---
    // Checked explicitly by its "espn:" prefix rather than falling through,
    // which would otherwise send an ESPN league's numeric id (indistinguishable
    // in shape from a Sleeper id) to Sleeper's API.
    if (isEspnLeagueId(queryLeagueID)) {
        if (teamsOnly) {
            if (seasonTeamsCache[queryLeagueID]) return seasonTeamsCache[queryLeagueID];
            const eTeams = await fetchAndNormalizeESPNRosters(queryLeagueID, { teamsOnly: true });
            if (Object.keys(eTeams.rosters).length > 0) seasonTeamsCache[queryLeagueID] = eTeams;
            return eTeams;
        }

        let eRosters = await fetchAndNormalizeESPNRosters(queryLeagueID);
        // A cold page load can race Supabase's session hydration -- the proxy
        // request resolves with no user id and this comes back with zero
        // rosters, indistinguishable from "this league genuinely has none".
        // Available Players reads that as "nobody owns anything" and shows
        // every NFL player as available, which is worse than a slow page: one
        // retry, giving hydration a moment to finish, recovers silently
        // instead of leaving that wrong for the rest of the session.
        if (!eRosters || Object.keys(eRosters.rosters || {}).length === 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            eRosters = await fetchAndNormalizeESPNRosters(queryLeagueID);
        }
        if (eRosters && Object.keys(eRosters.rosters).length > 0) {
            rostersStore.update(r => { r[queryLeagueID] = eRosters; return r; });
        }
        return eRosters;
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