import { getLeagueData } from './leagueData';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from './leagueRosters';
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { brackets } from '$lib/stores';
import { activeLeague } from '$lib/stores/leagueContext.js';

export const getBrackets = async (queryLeagueID) => {
    let id = queryLeagueID;
    if (!id) {
        const activeStore = get(activeLeague);
        id = activeStore?.sleeper_league_id || defaultLeagueID;
    }

    if(get(brackets).champs && get(brackets).league_id === id) {
        return get(brackets);
    }

    try {
        const [rosterRes, leagueData] = await Promise.all([
            getLeagueRosters(id),
            getLeagueData(id),
        ]);

        if(!rosterRes || !rosterRes.rosters) return null;
        
        const numRosters = Object.keys(rosterRes.rosters).length;

        const bracketsAndMatchupFetches = [
            fetch(`https://api.sleeper.app/v1/league/${id}/winners_bracket`, {compress: true}),
            fetch(`https://api.sleeper.app/v1/league/${id}/losers_bracket`, {compress: true}),
        ]

        let playoffType;
        const year = parseInt(leagueData.season);
        const playoffsStart = parseInt(leagueData.settings.playoff_week_start);

        if(year > 2019) playoffType = parseInt(leagueData.settings.playoff_round_type);
        else playoffType = 0;

        if(year == 2020 && playoffType == 1) playoffType++;

        for(let i = playoffsStart; i < 19; i++) {
            bracketsAndMatchupFetches.push(fetch(`https://api.sleeper.app/v1/league/${id}/matchups/${i}`, {compress: true}));
        }
        
        const bracketsAndMatchupResps = await Promise.all(bracketsAndMatchupFetches);
        const playoffMatchups = await Promise.all(bracketsAndMatchupResps.map(res => res.json()));

        const winnersData = playoffMatchups.shift();
        const losersData = playoffMatchups.shift();

        if(!winnersData || winnersData.length === 0) return null;

        const playoffRounds = winnersData[winnersData.length - 1].r;
        const loserRounds = losersData[losersData.length - 1].r;

        const champs = evaluateBracket(winnersData, playoffRounds, playoffMatchups, playoffType);
        let losers = evaluateBracket(losersData, loserRounds, playoffMatchups, playoffType);

        const finalBrackets = {
            numRosters,
            playoffsStart,
            playoffRounds,
            loserRounds,
            champs,
            losers,
            league_id: id
        }

        brackets.update(() => finalBrackets);
        return finalBrackets;
    } catch (e) {
        console.error("Brackets failed to load", e);
        return null;
    }
}

const evaluateBracket = (contestants, rounds, playoffMatchups, playoffType) => {
    let bracket = [];
    let consolations = [];
    let consolationMs = [];
    let fromWs = [];
    let teamsSeen = {};

    for(let i = 1; i <= rounds; i++) {
        const playoffBrackets = contestants.filter(m => m.r == i);
        const roundMatchups = [];
        const consolationMatchups = [];
        let first = true;
        const localConsolationMs = [];
        let localFromWs = [];

        for(const playoffBracket of playoffBrackets) {
            if((!playoffBracket.t1_from && playoffBracket.t2_from) || (!teamsSeen[playoffBracket.t1] && teamsSeen[playoffBracket.t2])) {
                let byeMatchup = processPlayoffMatchup({playoffBracket, playoffMatchups, i: i - 2, consolationMs, fromWs, playoffType, teamsSeen});
                byeMatchup.bye = true;
                byeMatchup[0].m = null;
                byeMatchup[1].m = null;
                byeMatchup[0].r--;
                byeMatchup[1].r--;
                byeMatchup[1].roster_id = null;
                if(first) {
                    if (bracket[i - 2]) bracket[i - 2].unshift(byeMatchup);
                    first = false;
                } else {
                    if (bracket[i - 2]) bracket[i - 2].push(byeMatchup);
                }
            }
            teamsSeen[playoffBracket.t1] = playoffBracket.m;
            teamsSeen[playoffBracket.t2] = playoffBracket.m;
            const roundMatchup = processPlayoffMatchup({playoffBracket, playoffMatchups, i: i - 1, consolationMs, fromWs, playoffType, teamsSeen});
            
            if(roundMatchup[0].winners) localFromWs.push(roundMatchup[0].m)
            
            if(roundMatchup[0].consolation) {
                localConsolationMs.push(roundMatchup[0].m)
                consolationMatchups.push(roundMatchup);
            } else {
                roundMatchups.push(roundMatchup);
            }
        }
        bracket.push(roundMatchups);

        for(const consolation of consolations) {
            for(const consolationMatchup of consolationMatchups) {
                if(consolationMatchup[0].winners && consolation[i-2] && consolation[i-2] && consolationMatchup[0].t1From == consolation[i-2][0][0].m) {
                    consolation[i-1] = [consolationMatchup];
                }
            }
        }

        const notFromWinners = consolationMatchups.filter(m => !m[0].fromWinners && !m[0].winners);
        const fromWinners = consolationMatchups.filter(m => m[0].fromWinners && !m[0].winners)
        if(notFromWinners.length) consolations.unshift(newConsolation(notFromWinners, rounds, i));
        if(fromWinners.length) consolations.push(newConsolation(fromWinners, rounds, i));
        
        fromWs = localFromWs;
        consolationMs = localConsolationMs;
    }
    return {bracket, consolations};
}

const newConsolation = (consolationMatchups, rounds, i) => {
    const newCons = new Array(rounds).fill([]);
    newCons[i - 1] = consolationMatchups;
    return newCons;
}

const processPlayoffMatchup = ({playoffBracket, playoffMatchups, i, consolationMs, fromWs, playoffType, teamsSeen}) => {
    const matchup = [];
    const m = playoffBracket.m;
    const r = playoffBracket.r;
    const p = playoffBracket.p;
    const t1From = teamsSeen[playoffBracket.t1];
    const t2From = teamsSeen[playoffBracket.t2];
    const winners = playoffBracket.t1_from?.w && playoffBracket.t2_from?.w ? true : false;
    const fromWinners = fromWs.indexOf(t2From || -999) > -1 ? true : false;
    let consolation = false;

    if((p && p != 1) || (playoffBracket.t1_from?.l && playoffBracket.t2_from?.l) || consolationMs.indexOf(t1From) > -1 || consolationMs.indexOf(t2From) > -1) {
        consolation = true;
    }

    const t1 = playoffBracket.t1;
    matchup.push(generateMatchupData(t1, t1From, {m, r, playoffMatchups, i, playoffType, winners, fromWinners, consolation, p}));
    
    const t2 = playoffBracket.t2;
    matchup.push(generateMatchupData(t2, t2From, {m, r, playoffMatchups, i, playoffType, winners, fromWinners, consolation, p}));
    
    return matchup;
}

const generateMatchupData = (t, tFrom, {m, r, playoffMatchups, i, playoffType, winners, fromWinners, consolation, p}) => {
    let matchup = { roster_id: null, points: undefined, starters: undefined, consolation, tFrom, m, r, winners, fromWinners }
    if(t && playoffMatchups && playoffMatchups[i]) {
        const tMatchup = playoffMatchups[i].filter(ma => ma.roster_id == t)[0];
        let tMatchupStarters = {}
        tMatchupStarters[1] = tMatchup?.starters;
        const tMatchupStartersPoints = {};
        tMatchupStartersPoints[1] = tMatchup?.starters_points;
        
        if(playoffType == 2 || (p && p == 1 && playoffType == 1)) {
            const secondWeek = playoffMatchups[i+1]?.filter(ma => ma.roster_id == t)[0];
            tMatchupStarters[2] = secondWeek?.starters;
            tMatchupStartersPoints[2] = secondWeek?.starters_points;
        }
        matchup.starters = tMatchupStarters;
        matchup.points = tMatchupStartersPoints;
        matchup.roster_id = t;
    }
    return matchup;
}