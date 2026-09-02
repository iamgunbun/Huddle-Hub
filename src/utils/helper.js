import { getLeagueData } from './helperFunctions/leagueData';
import { dues, leagueID, leagueName, dynasty, managers, homepageText, enableBlog } from './leagueInfo';
import { getLeagueTransactions as _getLeagueTransactions } from './helperFunctions/leagueTransactions';
import { getNflState } from './helperFunctions/nflState';
import { getLeagueRosters } from './helperFunctions/leagueRosters';
import { getLeagueTeamManagers as _getLeagueTeamManagers } from './helperFunctions/leagueTeamManagers';
import { getLeagueMatchups } from './helperFunctions/leagueMatchups';
import { getRivalryMatchups as _getRivalryMatchups } from './helperFunctions/rivalryMatchups';
import { getNews, stringDate } from './helperFunctions/news';
import { loadPlayers } from './helperFunctions/players';
import { waitForAll } from './helperFunctions/multiPromise';
import { getUpcomingDraft as _getUpcomingDraft, getPreviousDrafts as _getPreviousDrafts } from './helperFunctions/leagueDrafts';
import { getLeagueRecords as _getLeagueRecords } from './helperFunctions/leagueRecords';
import { cleanName, round, generateGraph, getTeamFromTeamManagers, gotoManager, getAuthor, parseDate, getAvatar } from './helperFunctions/universalFunctions';
import { predictScores } from './helperFunctions/predictOptimalScore';
import { getBrackets as _getBrackets } from './helperFunctions/leagueBrackets';
import { getBlogPosts, generateParagraph } from './helperFunctions/getBlogPosts';
import { getLeagueStandings } from './helperFunctions/leagueStandings';
import { getAwards as _getAwards } from './helperFunctions/leagueAwards';

// ==========================================
// UNIVERSAL PLATFORM SHIELD
// ==========================================
// Sleeper IDs are strictly numeric (e.g., "977259463943729152")
const isSleeperId = (id) => id && /^\d+$/.test(String(id));

// Shield functions that strictly require Sleeper IDs and don't have Yahoo routing yet
const getLeagueTransactions = async (id, ...args) => isSleeperId(id) ? _getLeagueTransactions(id, ...args) : [];
const getRivalryMatchups = async (id, ...args) => isSleeperId(id) ? _getRivalryMatchups(id, ...args) : {};
const getUpcomingDraft = async (id, ...args) => isSleeperId(id) ? _getUpcomingDraft(id, ...args) : null;
const getPreviousDrafts = async (id, ...args) => isSleeperId(id) ? _getPreviousDrafts(id, ...args) : [];
const getLeagueRecords = async (id, ...args) => isSleeperId(id) ? _getLeagueRecords(id, ...args) : {};
const getBrackets = async (id, ...args) => isSleeperId(id) ? _getBrackets(id, ...args) : [];
const getAwards = async (id, ...args) => isSleeperId(id) ? _getAwards(id, ...args) : [];

// Custom interceptor for Team Managers to support Yahoo team names/avatars
const getLeagueTeamManagers = async (id, ...args) => {
    if (isSleeperId(id)) return _getLeagueTeamManagers(id, ...args);
    
    // YAHOO MOCK: Map Yahoo Rosters to the Sleeper TeamManagers structure
    const rostersData = await getLeagueRosters(id);
    const teamManagersMap = {};
    const year = new Date().getFullYear();
    teamManagersMap[year] = {};
    
    if (rostersData && rostersData.rosters) {
        Object.values(rostersData.rosters).forEach(roster => {
            teamManagersMap[year][roster.roster_id] = {
                team: {
                    name: roster.team_name || `Team ${roster.roster_id}`,
                    avatar: roster.avatar || '/brand.png'
                },
                managers: [roster.owner_id]
            };
        });
    }
    return { teamManagersMap, users: {}, currentSeason: year };
};

export {
    enableBlog,
    homepageText,
    gotoManager,
    managers,
    getLeagueData,          // Unshielded (Has native Yahoo routing)
    getLeagueTransactions,  // Shielded
    getNflState,
    getLeagueRosters,       // Unshielded (Has native Yahoo routing)
    getLeagueTeamManagers,  // Custom Mocked
    getLeagueMatchups,      // Unshielded (Has native Yahoo routing)
    getRivalryMatchups,     // Shielded
    getNews,
    loadPlayers,
    waitForAll,
    getUpcomingDraft,       // Shielded
    getPreviousDrafts,      // Shielded
    getLeagueRecords,       // Shielded
    cleanName,
    round,
    dues,
    leagueID,
    leagueName,
    dynasty,
    getAwards,              // Shielded
    stringDate,
    getBrackets,            // Shielded
    generateGraph,
    getBlogPosts,
    generateParagraph,
    predictScores,          // Unshielded (Takes player array, not ID)
    getLeagueStandings,     // Unshielded (Uses mapped base data)
    getAuthor,
    parseDate,
    getAvatar,
    getTeamFromTeamManagers,
};