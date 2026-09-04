import { getLeagueData } from './leagueData';
import { leagueID as defaultLeagueID } from '../leagueInfo';
import { getNflState } from './nflState';
import { getLeagueRosters } from "./leagueRosters";
import { waitForAll } from './multiPromise';
import { getManagers, round, sortHighAndLow } from './universalFunctions';
import { Records } from '../dataClasses';
import { getBrackets } from './leagueBrackets';
import { fetchYahooScoreboardWeeks } from '../yahooService';
import { groupPlayoffRounds, isSameLeagueChain } from '../yahooHistory';

const isYahooLeague = (id) => !!id && (String(id).includes('.') || !/^\d+$/.test(String(id)));

let recordsCache = {}; 
let recordsCacheLeagueID = null;

export const getLeagueRecords = async (refresh = false, queryLeagueID = null) => {
    if (queryLeagueID) refresh = true; 

    if (recordsCache.leagueWeekHighs && !refresh && recordsCacheLeagueID === queryLeagueID) {
        return recordsCache;
    }

    // Keyed per league. A single shared "records" key meant the fallback read
    // below could hand one league's entire history to a different league.
    const cacheKey = `records_${queryLeagueID || 'default'}`;
    if (typeof window !== 'undefined') {
        try { localStorage.removeItem("records"); } catch { /* nothing to clean up */ }
    }

    if (!refresh && typeof window !== 'undefined') {
        let localRecords = await JSON.parse(localStorage.getItem(cacheKey));
        if (localRecords && localRecords.playoffData) {
            localRecords.stale = true;
            return localRecords;
        }
    }

    const nflState = await getNflState().catch((err) => { console.error(err); return { season_type: 'regular', week: 1 }; });
    let week = 0;
    if (nflState?.season_type === 'regular') {
        week = nflState.week - 1;
    } else if (nflState?.season_type === 'post') {
        week = 18;
    }

    let curSeason = queryLeagueID || defaultLeagueID;
    let currentYear;
    let lastYear;
    
    let regularSeason = new Records();
    let playoffRecords = new Records();

    let allRegDiffs = [];
    let allPlayoffDiffs = [];

    const visitedSeasons = new Set();
    let previousLeagueData = null;

    while (curSeason && curSeason !== 0 && curSeason !== "0" && !visitedSeasons.has(curSeason)) {
        visitedSeasons.add(curSeason);

        // teamsOnly: the records engine reads each team's W/L, points and
        // manager -- never its player list. On Yahoo that turns a per-team
        // roster fetch for every past season into a single standings call.
        const res = await waitForAll(
            getLeagueRosters(curSeason, { teamsOnly: true }),
            getLeagueData(curSeason)
        ).catch((err) => { console.error(err); return [null, null]; });

        const [rosterRes, leagueData] = res || [null, null];

        if (!leagueData || !rosterRes) break;

        // Guard the walk: a season that isn't genuinely this league's previous
        // one would otherwise add another league's records to these totals.
        if (previousLeagueData && !isSameLeagueChain(leagueData, previousLeagueData)) {
            console.warn(
                `Stopping the season walk at "${curSeason}": it isn't the season "${previousLeagueData.league_id}" was renewed from.`
            );
            break;
        }
        previousLeagueData = leagueData;

        const rosters = rosterRes?.rosters || {};

        if (leagueData.status === 'complete' || week > (leagueData.settings?.playoff_week_start || 15) - 1) {
            week = 99;
        }

        const regData = await processRegularSeason({ leagueData, rosters, curSeason, week, regularSeason });
        if (regData?.matchupDifferentials) {
            allRegDiffs.push(...regData.matchupDifferentials);
        }
        
        const pS = await processPlayoffs({ year: regData.year, curSeason, week, playoffRecords, rosters, leagueData });
        if (pS) {
            playoffRecords = pS.playoffRecords;
            allPlayoffDiffs.push(...pS.matchupDifferentials);
        }

        lastYear = regData.year;
        if (!currentYear && regData.year) {
            currentYear = regData.year;
        }
        curSeason = leagueData.previous_league_id || 0;
    }

    // One line that makes a wrong history diagnosable instead of guessable:
    // which seasons were actually walked, and how many distinct managers came
    // out of them. All-time totals that look far too big are almost always one
    // of these two numbers being wrong -- too many seasons (a chain that
    // wandered into another league) or too few managers (everyone collapsing
    // into a single identity, which merges the whole league into one record).
    const managerIds = Object.keys(regularSeason.leagueManagerRecords || {});
    console.log('[League history]', {
        league: queryLeagueID,
        seasonsWalked: [...visitedSeasons],
        seasonCount: visitedSeasons.size,
        distinctManagers: managerIds.length,
        managerIds,
    });

    playoffRecords.currentYear = regularSeason.currentYear;
    playoffRecords.lastYear = regularSeason.lastYear;
    regularSeason.finalizeAllTimeRecords({ currentYear, lastYear });
    playoffRecords.finalizeAllTimeRecords({ currentYear, lastYear });

    const regularSeasonData = regularSeason.returnRecords();
    const playoffData = playoffRecords.returnRecords();
    
    regularSeasonData.allTimeMatchupDifferentials = allRegDiffs;
    playoffData.allTimeMatchupDifferentials = allPlayoffDiffs;

    const recordsData = { regularSeasonData, playoffData };

    if (typeof window !== 'undefined') {
        // A failed cache write (quota) must never break the page -- keep the
        // in-memory cache either way.
        try {
            localStorage.setItem(cacheKey, JSON.stringify(recordsData));
        } catch (e) {
            console.warn("Records cache skipped:", e);
        }
        recordsCache = recordsData;
        recordsCacheLeagueID = queryLeagueID;
    }

    return recordsData;
}

const processRegularSeason = async ({rosters, leagueData, curSeason, week, regularSeason}) => {
    let year = parseInt(leagueData.season);
    if(leagueData.status === 'complete' || week > (leagueData.settings?.playoff_week_start || 15) - 1) {
        week = (leagueData.settings?.playoff_week_start || 15) - 1;
    }

    for(const rosterID in rosters) {
        analyzeRosters({year, roster: rosters[rosterID], regularSeason});
    }

    let startWeek = parseInt(week);
    
    const isYahoo = isYahooLeague(curSeason);
    let matchupsData = [];

    if (isYahoo) {
        const weeks = [];
        for (let w = 1; w <= startWeek; w++) weeks.push(w);

        // One batched request set for the whole regular season rather than a
        // burst of one-per-week proxy calls, which Yahoo rate-limits into 400s
        // once a multi-season history walk gets going.
        const scoreboard = await fetchYahooScoreboardWeeks(curSeason, weeks)
            .catch((err) => { console.error(err); return []; });

        const byWeek = new Map();
        scoreboard.forEach(m => {
            // An unplayed week still answers with a 0-0 matchup; recording it
            // would invent a real result and sink every "lowest score" record.
            if (!m.played || !Number.isFinite(m.week)) return;
            if (!byWeek.has(m.week)) byWeek.set(m.week, []);
            byWeek.get(m.week).push(m);
        });

        // Descending weeks, one entry per week including the empty ones:
        // processMatchups decrements its week counter on every call, so a gap
        // would shift every earlier week's records by one.
        for (let w = startWeek; w > 0; w--) {
            const arr = [];
            (byWeek.get(w) || []).forEach((m, idx) => {
                m.teams.forEach(team => {
                    arr.push({
                        roster_id: team.roster_id,
                        points: team.points,
                        matchup_id: `${w}-${idx + 1}`,
                    });
                });
            });
            matchupsData.push(arr);
        }
    } else {
        const matchupsPromises = [];
        let w = startWeek;
        while(w > 0) {
            matchupsPromises.push(fetch(`https://api.sleeper.app/v1/league/${curSeason}/matchups/${w}`, {compress: true}))
            w--;
        }

        const matchupsRes = await waitForAll(...matchupsPromises).catch((err) => { console.error(err); return []; });
        const matchupsJsonPromises = [];
        
        for(const matchupRes of (matchupsRes || [])) {
            if (matchupRes && matchupRes.ok) {
                matchupsJsonPromises.push(matchupRes.json());
            }
        }
        matchupsData = await waitForAll(...matchupsJsonPromises).catch((err) => { console.error(err); return []; });
    }

    let seasonPointsRecord = [];
    let matchupDifferentials = [];

    for(const matchupWeek of (matchupsData || [])) {
        const {sPR, mD, sW} =  processMatchups({matchupWeek, seasonPointsRecord, record: regularSeason, startWeek, matchupDifferentials, year})
        seasonPointsRecord = sPR;
        matchupDifferentials = mD;
        startWeek = sW;
    }

    const [biggestBlowouts, closestMatchups] = sortHighAndLow(matchupDifferentials, 'differential')
    const [seasonPointsHighs, seasonPointsLows] = sortHighAndLow(seasonPointsRecord, 'fpts')

    if(seasonPointsHighs.length > 0) {
        regularSeason.addSeasonWeekRecord({ year, biggestBlowouts, closestMatchups, seasonPointsLows, seasonPointsHighs });
    } else {
        year = null;
    }

    return { season: curSeason, year, matchupDifferentials };
}

const analyzeRosters = ({year, roster, regularSeason}) => {
    const rosterID = roster.roster_id;
    const managers = getManagers(roster);

    if(!roster.settings || (roster.settings.wins === 0 && roster.settings.ties === 0 && roster.settings.losses === 0)) return;

    const fptsFor = roster.settings.fpts + (roster.settings.fpts_decimal / 100);
    const fptsPerGame = round(fptsFor / (roster.settings.wins + roster.settings.losses + roster.settings.ties));

    const rosterRecords = {
        wins:  roster.settings.wins,
        losses:  roster.settings.losses,
        ties:  roster.settings.ties,
        fptsFor,
        fptsAgainst:  roster.settings.fpts_against + (roster.settings.fpts_against_decimal / 100),
        fptsPerGame,
        potentialPoints:  roster.settings.ppts ? (roster.settings.ppts + (roster.settings.ppts_decimal / 100)) : fptsFor,
        rosterID,
        year,
    }

    regularSeason.updateManagerRecord(managers, rosterRecords);
    regularSeason.addSeasonLongPoints({ rosterID, fpts: fptsFor, fptsPerGame, year });
}

const processMatchups = ({matchupWeek, seasonPointsRecord, record, startWeek, matchupDifferentials, year}) => {
    let matchups = {};
    let pSD = {};

    for(const matchup of matchupWeek) {
        const rosterID = matchup.roster_id;
        if(!rosterID) continue;
        let mID = matchup.matchup_id;
        if(!mID) {
            if(!pSD[rosterID]) {
                pSD[rosterID] = { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0, potentialPoints: 0, fptspg: 0, pOGames: 0, byes: 0 }
            }
            pSD[rosterID].pOGames = 1;
            const m = matchup.m;
            if(!m) {
                pSD[rosterID].byes = 1;
                continue;
            }
            mID = `PS:${m}`
        }
        
        const entry = { rosterID, fpts: matchup.points, week: startWeek, year }
        if(!matchups[mID]) matchups[mID] = [];
        matchups[mID].push(entry);
        record.addLeagueWeekRecord(entry);
        seasonPointsRecord.push(entry);
    }
    
    startWeek--;

    for(const matchupKey in matchups) {
        const matchup = matchups[matchupKey];
        let home = matchup[0];
        let away = matchup[1];
        if(!away || !home) continue;
        if(home.fpts < away.fpts) {
            home = matchup[1];
            away = matchup[0];
        }

        const matchupDifferential = {
            year: home.year,
            week: home.week,
            home: { rosterID: home.rosterID, fpts: home.fpts },
            away: { rosterID: away.rosterID, fpts: away.fpts },
            differential: home.fpts - away.fpts
        }
        matchupDifferentials.push(matchupDifferential);

        if(matchupKey.split(":")[0] === "PS") {
            pSD[home.rosterID].wins = 1;
            pSD[home.rosterID].fptsFor = home.fpts;
            pSD[home.rosterID].fptsAgainst = away.fpts;
            
            pSD[away.rosterID].losses = 1;
            pSD[away.rosterID].fptsFor = away.fpts;
            pSD[away.rosterID].fptsAgainst = home.fpts;
        }
    }

    return { sPR: seasonPointsRecord, mD: matchupDifferentials, sW: startWeek, pSD }
}

const processPlayoffs = async ({curSeason, playoffRecords, year, week, rosters, leagueData}) => {
    // Yahoo publishes no winners/losers bracket endpoint, so its postseason is
    // reconstructed from the scoreboard's own is_playoffs flag instead.
    if (isYahooLeague(curSeason)) {
        return processYahooPlayoffs({curSeason, playoffRecords, year, rosters, leagueData});
    }

    const bracketData = await getBrackets(curSeason).catch(() => null);
    
    if (!bracketData) return null;

    const { playoffsStart, playoffRounds, champs } = bracketData;
    if(week <= playoffsStart || !year) return null;

    let seasonPointsRecord = [];
    let matchupDifferentials = [];
    let postSeasonData = {};

    const champBracket = digestBracket({bracket: champs.bracket, playoffsStart, matchupDifferentials, postSeasonData, playoffRecords, playoffRounds, consolation: false, seasonPointsRecord, year});
    postSeasonData = champBracket.postSeasonData;
    seasonPointsRecord = champBracket.seasonPointsRecord;
    playoffRecords = champBracket.playoffRecords;
    matchupDifferentials = champBracket.matchupDifferentials;

    const consolationBracket = digestBracket({bracket: champs.consolations, playoffsStart, matchupDifferentials, postSeasonData, playoffRecords, playoffRounds, consolation: true, seasonPointsRecord, year});
    postSeasonData = consolationBracket.postSeasonData;
    seasonPointsRecord = consolationBracket.seasonPointsRecord;
    playoffRecords = consolationBracket.playoffRecords;
    matchupDifferentials = consolationBracket.matchupDifferentials;

    return finalizePlayoffRecords({postSeasonData, seasonPointsRecord, matchupDifferentials, playoffRecords, rosters, year});
}

// Shared by both platforms: turn a season's accumulated postseason matchups into
// manager records and season-week records.
const finalizePlayoffRecords = ({postSeasonData, seasonPointsRecord, matchupDifferentials, playoffRecords, rosters, year}) => {
    for(const rosterID in postSeasonData) {
        const pSD = postSeasonData[rosterID];
        const fptsPerGame = round(pSD.fptsFor / (pSD.wins + pSD.losses + pSD.ties));
        pSD.fptsPerGame = fptsPerGame;
        pSD.year = year;
        pSD.rosterID = rosterID;

        playoffRecords.addSeasonLongPoints({ fpts: pSD.fptsFor, fptsPerGame, year, rosterID: rosterID });

        const managers = getManagers(rosters[rosterID] || {});
        playoffRecords.updateManagerRecord(managers, pSD);
    }

    const [biggestBlowouts, closestMatchups] = sortHighAndLow(matchupDifferentials, 'differential');
    const [seasonPointsHighs, seasonPointsLows] = sortHighAndLow(seasonPointsRecord, 'fpts');

    if(seasonPointsHighs.length > 0) {
        playoffRecords.addSeasonWeekRecord({ year, biggestBlowouts, closestMatchups, seasonPointsLows, seasonPointsHighs });
    }
    
    return { playoffRecords, matchupDifferentials };
}

// Yahoo's postseason, rebuilt from the scoreboard.
//
// Every scoreboard matchup states whether it is a playoff game and whether it
// is a consolation game, so the rounds can be reassembled by week without a
// bracket. Only games Yahoo reports as final are counted, which keeps an
// in-progress postseason from being recorded as a pile of 0-0 results.
const processYahooPlayoffs = async ({curSeason, playoffRecords, year, rosters, leagueData}) => {
    if (!year) return null;

    const playoffsStart = parseInt(leagueData?.settings?.playoff_week_start) || 15;
    const endWeek = parseInt(leagueData?.settings?.end_week) || (playoffsStart + 2);

    const weeks = [];
    for (let w = playoffsStart; w <= Math.min(endWeek, 18); w++) weeks.push(w);
    if (!weeks.length) return null;

    const scoreboard = await fetchYahooScoreboardWeeks(curSeason, weeks)
        .catch((err) => { console.error(err); return []; });

    const rounds = groupPlayoffRounds(scoreboard);
    if (!rounds.length) return null;

    let seasonPointsRecord = [];
    let matchupDifferentials = [];
    let postSeasonData = {};
    let matchupCounter = 0;

    for (const round of rounds) {
        // processMatchups treats an entry WITHOUT a matchup_id as a postseason
        // game and keys it off `m`, which is what accumulates playoff wins and
        // losses -- so playoff entries deliberately carry `m` and no matchup_id.
        const matchupWeek = [];
        round.matchups.forEach(matchup => {
            matchupCounter++;
            matchup.teams.forEach(team => {
                matchupWeek.push({ roster_id: team.roster_id, points: team.points, m: matchupCounter });
            });
        });

        const label = round.consolation
            ? `(C) Week ${round.week}`
            : getStartWeek(round.roundIndex, round.totalRounds, false, playoffsStart);

        const {sPR, mD, pSD} = processMatchups({
            matchupWeek,
            seasonPointsRecord,
            record: playoffRecords,
            startWeek: label,
            matchupDifferentials,
            year,
        });

        postSeasonData = meshPostSeasonData(postSeasonData, pSD);
        seasonPointsRecord = sPR;
        matchupDifferentials = mD;
    }

    return finalizePlayoffRecords({postSeasonData, seasonPointsRecord, matchupDifferentials, playoffRecords, rosters, year});
}

const digestBracket = ({bracket, playoffRecords, playoffRounds, matchupDifferentials, postSeasonData, consolation, seasonPointsRecord, playoffsStart, year}) => {
    for(let i = 0; i < bracket.length; i++) {
        const startWeek = getStartWeek(i + (playoffRounds - bracket.length), playoffRounds, consolation, playoffsStart);
        const matchupWeek = [];
        for(let matchups of bracket[i]) {
            if(consolation) matchups.flat();
            for(const matchup of matchups) {
                if(matchup.r) {
                    const newMatchup = {...matchup}
                    let points = 0;
                    for(const k in newMatchup.points) {
                        points += newMatchup.points[k].reduce((t, nV) => t + nV, 0);
                    }
                    newMatchup.points = points;
                    matchupWeek.push(newMatchup);
                }
            }
        }
        
        const {sPR, mD, pSD} =  processMatchups({matchupWeek, seasonPointsRecord, record: playoffRecords, startWeek, matchupDifferentials, year})
        postSeasonData = meshPostSeasonData(postSeasonData, pSD);
        seasonPointsRecord = sPR;
        matchupDifferentials = mD;
    }
    return {postSeasonData, seasonPointsRecord, playoffRecords, matchupDifferentials}
}

const meshPostSeasonData = (postSeasonData, pSD) => {
    for(const key in pSD) {
        if(!postSeasonData[key]) {
            postSeasonData[key] = pSD[key];
            continue;
        }
        for(const k in pSD[key]) {
            if(k === 'manager') continue;
            postSeasonData[key][k] += pSD[key][k];
        }
    }
    return postSeasonData;
}

const getStartWeek = (i, playoffRounds, consolation, playoffsStart) => {
    if (consolation) return `(C) Week ${playoffsStart + i}`;
    switch (playoffRounds - i) {
        case 1: return "Finals";
        case 2: return "Semi-Finals"
        case 3: return "Quarter-Finals"
        default: return "Qualifiers";
    }
}