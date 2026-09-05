import { getLeagueData } from "./leagueData";
import { getNflState } from "./nflState";
import { get } from 'svelte/store';
import { matchupsStore } from '$lib/stores';
import { activeLeague } from '$lib/stores/leagueContext.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { fetchAndNormalizeYahooMatchups } from '../yahooService';
import { fetchESPNSchedule } from '../espnService';
import { isYahooLeagueId as isYahooLeague, isEspnLeagueId } from '../platformIds';

export const getLeagueMatchups = async (queryLeagueID) => {
    let id = queryLeagueID;
    if (!id) {
        const activeStore = get(activeLeague);
        id = activeStore?.sleeper_league_id || defaultLeagueID;
    }

    if (!id) return null;

    const store = get(matchupsStore);
    if (store && store.matchupWeeks && store.league_id === id) {
        return store;
    }

    try {
        const [nflState, leagueData] = await Promise.all([
            getNflState(),
            getLeagueData(id),
        ]);

        if (!leagueData) return null;

        let week = 1;
        if (nflState?.season_type === 'regular') {
            week = nflState.display_week;
        } else if (nflState?.season_type === 'post') {
            week = 18;
        }

        const year = leagueData.season;
        const regularSeasonLength = leagueData.settings?.playoff_week_start ? leagueData.settings.playoff_week_start - 1 : 14;

        // --- YAHOO PLATFORM ROUTING (Uses /api/yahoo-proxy) ---
        if (isYahooLeague(id)) {
            const yPromises = [];
            for (let i = 1; i <= week; i++) {
                yPromises.push(fetchAndNormalizeYahooMatchups(id, i));
            }
            const yWeeks = await Promise.all(yPromises);
            
            const matchupWeeks = yWeeks
                .filter(w => w && Object.keys(w.matchups || {}).length > 0)
                .map(w => ({
                    matchups: w.matchups, 
                    week: w.week 
                }));

            const matchupsResponse = {
                matchupWeeks,
                year,
                week,
                regularSeasonLength,
                league_id: id
            };
            matchupsStore.update(() => matchupsResponse);
            return matchupsResponse;
        }

        // --- ESPN PLATFORM ROUTING ---
        // ESPN's `mMatchup` view returns the whole season's schedule in one
        // call, unlike Yahoo which needs one proxy call per week -- so the
        // per-week rows are sliced out of a single already-fetched payload.
        if (isEspnLeagueId(id)) {
            const byWeek = await fetchESPNSchedule(id);
            const eWeeks = [];
            for (let i = 1; i <= week; i++) {
                const pairs = byWeek[i];
                if (!pairs || !pairs.length) continue;
                const matchups = {};
                pairs.forEach((teams, idx) => { matchups[idx + 1] = teams; });
                eWeeks.push({ matchups, week: i });
            }

            const matchupsResponse = {
                matchupWeeks: eWeeks,
                year,
                week,
                regularSeasonLength,
                league_id: id
            };
            matchupsStore.update(() => matchupsResponse);
            return matchupsResponse;
        }

        // --- SLEEPER PLATFORM ROUTING ---
        const maxWeeks = leagueData.settings?.playoff_week_start || 15;
        const matchupsPromises = [];
        for (let i = 1; i < maxWeeks; i++) {
            matchupsPromises.push(fetch(`https://api.sleeper.app/v1/league/${id}/matchups/${i}`, { compress: true }));
        }

        const matchupsRes = await Promise.all(matchupsPromises);
        const matchupsData = await Promise.all(matchupsRes.map(res => res.json()));

        const matchupWeeks = [];
        for (let i = 1; i < matchupsData.length + 1; i++) {
            const processed = processMatchups(matchupsData[i - 1], i);
            if (processed) {
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
        };

        matchupsStore.update(() => matchupsResponse);
        return matchupsResponse;

    } catch (e) {
        console.error("Matchups failed to load completely: ", e);
        return null;
    }
};

const processMatchups = (inputMatchups, week) => {
    if (!inputMatchups || inputMatchups.length === 0) return false;
    const matchups = {};
    for (const match of inputMatchups) {
        if (!matchups[match.matchup_id]) matchups[match.matchup_id] = [];
        matchups[match.matchup_id].push({
            roster_id: match.roster_id,
            starters: match.starters || [],
            points: match.starters_points || [],
        });
    }
    return { matchups, week };
};