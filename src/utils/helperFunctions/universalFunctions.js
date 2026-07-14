import { managers as managersObj } from '$lib/utils/leagueInfo';
import { goto } from "$app/navigation";
import { stringDate } from './news';

const QUESTION = 'managers/question.jpg';

export const cleanName = (name) => {
    return name.replace('Team ', '').toLowerCase().replace(/[  '!"#$%&\\'()\*+,\-\.\/:;<=>?@\[\\\]\^_`{|}~']/g, "");
}

export const round = (num) => {
    if(typeof(num) =="string") {
        num = parseFloat(num)
    }
    return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(2);
}

const min = (stats, roundOverride, max) => {
    const num = Math.min(...stats);
    let minAnswer = Math.floor(num / roundOverride) * roundOverride;
    if(max && num > 0) {
        let i = 0;
        while(minAnswer > 0 && (num - minAnswer) / (max - minAnswer) < .15) {
            minAnswer -= roundOverride;
            i++;
            if(i > 100) break;
        }
    }
    return minAnswer > 0 ? minAnswer : 0;
}

const max = (stats, roundOverride) => {
    const num = Math.max(...stats);
    return Math.ceil(num / roundOverride) * roundOverride;
}

export const gotoManager = ({leagueTeamManagers, managerID, rosterID, year}) => {
    if(!managersObj || !managersObj.length) return;
    let managersIndex = -1;
    if(!year || year > leagueTeamManagers?.currentSeason) {
        year = leagueTeamManagers?.currentSeason;
    }
    if(managerID) {
        managersIndex = managersObj.findIndex(m => m.managerID == managerID);
        if(managersIndex < 0 && leagueTeamManagers?.teamManagersMap?.[year]) {
            for(const rID in leagueTeamManagers.teamManagersMap[year]) {
                if(!leagueTeamManagers.teamManagersMap[year][rID]) continue;
                if(leagueTeamManagers.teamManagersMap[year][rID].managers?.includes(managerID)) {
                    managersIndex = managersObj.findIndex(m => m.roster == rID);
                    goto(`/manager?manager=${managersIndex}`);
                    return;
                }
            }
        }
    } else if(rosterID) {
        if(leagueTeamManagers?.teamManagersMap?.[year]?.[rosterID]?.managers) {
            for(const mID of leagueTeamManagers.teamManagersMap[year][rosterID].managers) {
                managersIndex = managersObj.findIndex(m => m.managerID == mID);
                if(managersIndex > -1) {
                    goto(`/manager?manager=${managersIndex}`);
                    return;
                }
            }
        }
        managersIndex = managersObj.findIndex(m => m.roster == rosterID);
    }
    goto(`/manager?manager=${managersIndex}`);
}

export const getAuthor = (leagueTeamManagers, author) => {
    if (!leagueTeamManagers?.users) return author;
    for(const userID in leagueTeamManagers.users) {
        if(leagueTeamManagers.users[userID]?.user_name?.toLowerCase() == author?.toLowerCase()) {
            return [`<a href="/manager?manager=${managersObj.findIndex(m => m.managerID == String(userID))}">${leagueTeamManagers.users[userID].display_name}</a>`];
        }
    }
    return author;
}

export const getAvatar = (leagueTeamManagers, author) => {
    if (!leagueTeamManagers?.users) return QUESTION;
    for(const uID in leagueTeamManagers.users) {
        if(leagueTeamManagers.users[uID]?.user_name?.toLowerCase() == author?.toLowerCase()) {
            return `https://sleepercdn.com/avatars/thumbs/${leagueTeamManagers.users[uID].avatar}`;
        }
    }
    return QUESTION;
}

export const parseDate = (rawDate) => {
    const ts = Date.parse(rawDate);
    const d = new Date(ts);
    return stringDate(d);
}

export const generateGraph = ({stats, x, stat, header, field, short, secondField = null}, year, roundOverride = 10, xMinOverride = null) => {
    if(!stats) return null;
    const graph = {
        stats: [], secondStats: [], managerIDs: [], rosterIDs: [],
        labels: {x, stat}, header, xMin: 0, xMax: 0, short, year
    }
    const sortedStats = [...stats].sort((a, b) => b[field] - a[field]);
    for(const indivStat of sortedStats) {
        graph.stats.push(indivStat[field]);
        if(secondField) graph.secondStats.push(indivStat[secondField]);
        if(indivStat.managerID) {
            graph.managerIDs.push(indivStat.managerID);
            graph.rosterIDs.push(null);
        } else if(indivStat.rosterID) {
            graph.managerIDs.push(null);
            graph.rosterIDs.push(indivStat.rosterID);
        }
    }
    graph.xMax = max(graph.stats, roundOverride);
    graph.xMin = min(graph.stats, roundOverride, graph.xMax);
    if(secondField) graph.xMin = min(graph.secondStats, roundOverride, graph.xMax);
    if(xMinOverride) graph.xMin = xMinOverride;
    return graph;
}

export const sortHighAndLow = (arr, field) => {
    const sorted = arr.sort((a, b) => b[field] - a[field]);
    const high = sorted.slice(0, 10);
    const low = sorted.slice(-10).reverse();
    return [high, low]
}

export const getManagers = (roster) => {
    const managers = [];
    if(roster.owner_id) managers.push(roster.owner_id);
    if(roster.co_owners) {
        for(const coOwner of roster.co_owners) {
            managers.push(coOwner);
        }
    }
    return managers;
}

export const getTeamData = (users, ownerID) => {
    const user = users ? users[ownerID] : null;
    if(user) {
        return {
            avatar: user.metadata?.avatar ? user.metadata.avatar : `https://sleepercdn.com/avatars/thumbs/${user.avatar}`,
            name: user.metadata?.team_name ? user.metadata.team_name : user.display_name,
        }
    }
    return {
        avatar: `https://sleepercdn.com/images/v2/icons/player_default.webp`,
        name: 'Unknown Team',
    }
}

export const getAvatarFromTeamManagers = (teamManagers, rosterID, year) => {
    if(!teamManagers || !teamManagers.teamManagersMap) return QUESTION;
    if(!year || year > teamManagers.currentSeason) year = teamManagers.currentSeason;
    const yearManagers = teamManagers.teamManagersMap[year];
    if(!yearManagers) return QUESTION;
    const roster = yearManagers[rosterID];
    if(!roster || !roster.team) return QUESTION;
    return roster.team.avatar || QUESTION;
}

export const getTeamNameFromTeamManagers = (teamManagers, rosterID, year) => {
    if(!teamManagers || !teamManagers.teamManagersMap) return 'Unknown Team';
    if(!year || year > teamManagers.currentSeason) year = teamManagers.currentSeason;
    if (!teamManagers.teamManagersMap[year] || !teamManagers.teamManagersMap[year][rosterID]) return 'Unknown Team';
    return teamManagers.teamManagersMap[year][rosterID].team?.name || 'Unknown Team';
}

export const renderManagerNames = (teamManagers, rosterID, year) => {
    if(!teamManagers || !teamManagers.teamManagersMap) return "";
    if(!year || year > teamManagers.currentSeason) year = teamManagers.currentSeason;
    if (!teamManagers.teamManagersMap[year] || !teamManagers.teamManagersMap[year][rosterID]) return "";

    let managersString = "";
    for(const managerID of teamManagers.teamManagersMap[year][rosterID].managers || []) {
        const manager = teamManagers.users[managerID];
        if(manager) {
            if(managersString !== "") managersString += ", "
            managersString += manager.display_name;
        }
    }
    return managersString;
}

export const getTeamFromTeamManagers = (teamManagers, rosterID, year) => {
    // SAFE FALLBACK: If Svelte requests data before API finishes, return placeholder instead of crashing
    if(!teamManagers || !teamManagers.teamManagersMap) return { name: 'Loading...', avatar: QUESTION };
    if(!year || year > teamManagers.currentSeason) year = teamManagers.currentSeason;
    
    // SAFE FALLBACK: If roster ID doesn't exist in the current mapped year
    if (!teamManagers.teamManagersMap[year] || !teamManagers.teamManagersMap[year][rosterID]) {
        return { name: 'Loading...', avatar: QUESTION };
    }
    
    return teamManagers.teamManagersMap[year][rosterID]['team'];
}

export const getNestedTeamNamesFromTeamManagers = (teamManagers, year, rosterID) => {
    if(!teamManagers || !teamManagers.teamManagersMap) return 'Unknown Team';
    
    const originalName = teamManagers.teamManagersMap[year]?.[rosterID]?.team?.name || 'Unknown Team';
    const currentName = teamManagers.teamManagersMap[teamManagers.currentSeason]?.[rosterID]?.team?.name || 'Unknown Team';
    
    if(cleanName(originalName) !== cleanName(currentName)) {
        return `${originalName}<div class="curOwner">(${currentName})</div>`;
    }
    return originalName;
}

export const getDatesActive = (teamManagers, managerID) => {
    if(!managerID || !teamManagers?.teamManagersMap) return {start: null, end: null};
    let datesActive = {start: null, end: null};
    const years = Object.keys(teamManagers.teamManagersMap).sort((a, b) => b - a);
    for(const year of years) {
        for(const rosterID in teamManagers.teamManagersMap[year]) {
            if(teamManagers.teamManagersMap[year][rosterID]?.managers?.includes(managerID)) {
                datesActive.start = year;
                if(!datesActive.end) {
                    datesActive.end = year;
                }
                break;
            }
        }
    }
    if(datesActive.end == teamManagers.currentSeason) {
        datesActive.end = null;
    }
    return datesActive;
}

export const getRosterIDFromManagerID = (teamManagers, managerID) => {
    if(!managerID || !teamManagers?.teamManagersMap) return null;
    const years = Object.keys(teamManagers.teamManagersMap).sort((a, b) => b - a);
    for(const year of years) {
        for(const rosterID in teamManagers.teamManagersMap[year]) {
            if(teamManagers.teamManagersMap[year][rosterID]?.managers?.includes(managerID)) {
                return {rosterID, year};
            }
        }
    }
    return null;
}

export const getRosterIDFromManagerIDAndYear = (teamManagers, managerID, year) => {
    if(!managerID || !year || !teamManagers?.teamManagersMap?.[year]) return null;
    for(const rosterID in teamManagers.teamManagersMap[year]) {
        if(teamManagers.teamManagersMap[year][rosterID]?.managers?.includes(managerID)) {
            return rosterID;
        }
    }
    return null;
}

export const checkIfManagerReceivedAward = (teamManagers, awardRosterID, year, managerID) => {
    if(!managerID || !teamManagers?.teamManagersMap?.[year]?.[awardRosterID]) return false;
    return teamManagers.teamManagersMap[year][awardRosterID].managers?.includes(managerID) || false;
}