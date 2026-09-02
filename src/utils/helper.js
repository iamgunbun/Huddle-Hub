import { getLeagueData as _getLeagueData } from './helperFunctions/leagueData';
import { dues, leagueID, leagueName, dynasty, managers, homepageText, enableBlog } from './leagueInfo';
import { getLeagueTransactions as _getLeagueTransactions } from './helperFunctions/leagueTransactions';
import { getNflState } from './helperFunctions/nflState';
import { getLeagueRosters as _getLeagueRosters } from './helperFunctions/leagueRosters';
import { getLeagueTeamManagers as _getLeagueTeamManagers } from './helperFunctions/leagueTeamManagers';
import { getLeagueMatchups as _getLeagueMatchups } from './helperFunctions/leagueMatchups';
import { getRivalryMatchups as _getRivalryMatchups } from './helperFunctions/rivalryMatchups';
import { getNews, stringDate } from './helperFunctions/news';
import { loadPlayers } from './helperFunctions/players';
import { waitForAll } from './helperFunctions/multiPromise';
import { getUpcomingDraft as _getUpcomingDraft, getPreviousDrafts as _getPreviousDrafts } from './helperFunctions/leagueDrafts';
import { getLeagueRecords as _getLeagueRecords } from './helperFunctions/leagueRecords';
import { cleanName, round, generateGraph, getTeamFromTeamManagers, gotoManager, getAuthor, parseDate, getAvatar } from './helperFunctions/universalFunctions';
import { predictScores as _predictScores } from './helperFunctions/predictOptimalScore';
import { getBrackets as _getBrackets } from './helperFunctions/leagueBrackets';
import { getBlogPosts, generateParagraph } from './helperFunctions/getBlogPosts';
import { getLeagueStandings as _getLeagueStandings } from './helperFunctions/leagueStandings';
import { getAwards as _getAwards } from './helperFunctions/leagueAwards';

// ==========================================
// UNIVERSAL PLATFORM SHIELD
// ==========================================
// Sleeper IDs are strictly numeric (e.g., "977259463943729152")
// Yahoo/ESPN IDs contain letters or are formatted differently (e.g., "470.l.604026")
const isSleeperId = (id) => id && /^\d+$/.test(String(id));

// Wrap all league-specific API fetches. If a Yahoo/ESPN ID is passed, 
// short-circuit the network request to prevent 404 crashes and return safe fallback data.
const getLeagueData = async (id, ...args) => isSleeperId(id) ? _getLeagueData(id, ...args) : null;
const getLeagueTransactions = async (id, ...args) => isSleeperId(id) ? _getLeagueTransactions(id, ...args) : [];
const getLeagueRosters = async (id, ...args) => isSleeperId(id) ? _getLeagueRosters(id, ...args) : [];
const getLeagueTeamManagers = async (id, ...args) => isSleeperId(id) ? _getLeagueTeamManagers(id, ...args) : { teamManagersMap: {}, users: {}, currentSeason: new Date().getFullYear() };
const getLeagueMatchups = async (id, ...args) => isSleeperId(id) ? _getLeagueMatchups(id, ...args) : {};
const getRivalryMatchups = async (id, ...args) => isSleeperId(id) ? _getRivalryMatchups(id, ...args) : {};
const getUpcomingDraft = async (id, ...args) => isSleeperId(id) ? _getUpcomingDraft(id, ...args) : null;
const getPreviousDrafts = async (id, ...args) => isSleeperId(id) ? _getPreviousDrafts(id, ...args) : [];
const getLeagueRecords = async (id, ...args) => isSleeperId(id) ? _getLeagueRecords(id, ...args) : {};
const predictScores = async (id, ...args) => isSleeperId(id) ? _predictScores(id, ...args) : {};
const getBrackets = async (id, ...args) => isSleeperId(id) ? _getBrackets(id, ...args) : [];
const getLeagueStandings = async (id, ...args) => isSleeperId(id) ? _getLeagueStandings(id, ...args) : [];
const getAwards = async (id, ...args) => isSleeperId(id) ? _getAwards(id, ...args) : [];

export {
    enableBlog,
    homepageText,
    gotoManager,
    managers,
    getLeagueData,
    getLeagueTransactions,
    getNflState,
    getLeagueRosters,
    getLeagueTeamManagers,
    getLeagueMatchups,
    getRivalryMatchups,
    getNews,
    loadPlayers,
    waitForAll,
    getUpcomingDraft,
    getPreviousDrafts,
    getLeagueRecords,
    cleanName,
    round,
    dues,
    leagueID,
    leagueName,
    dynasty,
    getAwards,
    stringDate,
    getBrackets,
    generateGraph,
    getBlogPosts,
    generateParagraph,
    predictScores,
    getLeagueStandings,
    getAuthor,
    parseDate,
    getAvatar,
    getTeamFromTeamManagers,
};