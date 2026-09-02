import { getLeagueData } from './helperFunctions/leagueData';
import { dues, leagueID, leagueName, dynasty, managers, homepageText, enableBlog } from './leagueInfo';
import { getLeagueTransactions as _getLeagueTransactions } from './helperFunctions/leagueTransactions';
import { getNflState } from './helperFunctions/nflState';
import { getLeagueRosters } from './helperFunctions/leagueRosters';
import { getLeagueTeamManagers as _getLeagueTeamManagers } from './helperFunctions/leagueTeamManagers';
import { getLeagueMatchups as _getLeagueMatchups } from './helperFunctions/leagueMatchups';
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
// PLATFORM SHIELD (Yahoo Block)
// ==========================================
const isYahooId = (id) => id && (String(id).includes('.l.') || !/^\d+$/.test(String(id)));

const getLeagueTransactions = async (id, ...args) => isYahooId(id) ? [] : _getLeagueTransactions(id, ...args);
const getRivalryMatchups = async (id, ...args) => isYahooId(id) ? {} : _getRivalryMatchups(id, ...args);
const getUpcomingDraft = async (id, ...args) => isYahooId(id) ? null : _getUpcomingDraft(id, ...args);
const getPreviousDrafts = async (id, ...args) => isYahooId(id) ? [] : _getPreviousDrafts(id, ...args);
const getBrackets = async (id, ...args) => isYahooId(id) ? null : _getBrackets(id, ...args);

// Safely format empty state for League Records to prevent UI crashes
const getLeagueRecords = async (arg1 = false, arg2 = null, ...args) => {
    const refresh = typeof arg1 === 'boolean' ? arg1 : false;
    const queryLeagueID = typeof arg1 === 'string' ? arg1 : arg2;
    
    if (isYahooId(queryLeagueID)) {
        return { 
            regularSeasonData: { allTimeMatchupDifferentials: [], currentYear: null, lastYear: null }, 
            playoffData: { allTimeMatchupDifferentials: [], currentYear: null, lastYear: null } 
        };
    }
    return _getLeagueRecords(refresh, queryLeagueID, ...args);
};

// Safely format empty state for Trophy Room to prevent UI crashes
const getAwards = async (arg1 = false, arg2 = null, ...args) => {
    const refresh = typeof arg1 === 'boolean' ? arg1 : false;
    const queryLeagueID = typeof arg1 === 'string' ? arg1 : arg2;

    if (isYahooId(queryLeagueID)) return [];
    return _getAwards(refresh, queryLeagueID, ...args);
};

// Custom interceptor for Team Managers to support Yahoo team names/avatars AND User Profiles
const getLeagueTeamManagers = async (id, ...args) => {
    if (isYahooId(id)) {
        const rostersData = await getLeagueRosters(id);
        const teamManagersMap = {};
        const users = {}; 
        const year = new Date().getFullYear();
        teamManagersMap[year] = {};
        
        if (rostersData && rostersData.rosters) {
            Object.values(rostersData.rosters).forEach(roster => {
                // Map the team assignments
                teamManagersMap[year][roster.roster_id] = {
                    team: {
                        name: roster.team_name || `Team ${roster.roster_id}`,
                        avatar: roster.avatar || '/brand.png'
                    },
                    managers: [roster.owner_id]
                };
                
                // POPULATE USERS DICTIONARY SO MANAGER DATA RENDERS
                users[roster.owner_id] = {
                    display_name: roster.manager_name || roster.team_name,
                    avatar: roster.avatar || '/brand.png',
                    user_id: roster.owner_id
                };
            });
        }
        return { teamManagersMap, users, currentSeason: year };
    }
    return _getLeagueTeamManagers(id, ...args);
};

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