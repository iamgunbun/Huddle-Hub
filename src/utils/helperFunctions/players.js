import { leagueID as defaultLeagueID } from '../leagueInfo';

export const loadPlayers = async (activeLeagueId) => {
    // Fall back to your main project's hardcoded league ID if context isn't ready
    const currentId = activeLeagueId || defaultLeagueID;
    const now = Math.round(new Date().getTime() / 1000);
    
    // Safeguard: Abort early if we are caught in an uninitialized rendering cycle
    if (!currentId || currentId === 'default_id' || currentId === 'undefined') {
        return { players: {}, stale: true };
    }
    
    let playersInfo = null;
    let expiration = null;
    
    try {
        playersInfo = JSON.parse(localStorage.getItem(`playersInfo_${currentId}`));
        expiration = parseInt(localStorage.getItem(`expiration_${currentId}`));
    } catch (e) {
        console.warn("Failed to read local player cache safely:", e);
    }

    if (playersInfo && playersInfo['1426'] && expiration && now < expiration) {
        return { players: playersInfo, stale: false };
    }

    try {
        const [sleeperRes, leagueRes, stateRes] = await Promise.all([
            fetch("https://api.sleeper.app/v1/players/nfl"),
            fetch(`https://api.sleeper.app/v1/league/${currentId}`),
            fetch("https://api.sleeper.app/v1/state/nfl")
        ]);
        
        if (!leagueRes.ok) {
            console.warn(`Sleeper league metadata returned status ${leagueRes.status}. Aborting projection calculation.`);
            return { players: playersInfo || {}, stale: true };
        }
        
        const rawPlayers = await sleeperRes.json();
        const leagueData = await leagueRes.json();
        const nflState = await stateRes.json();
        
        const scoringSettings = leagueData?.scoring_settings || {};
        const week = nflState.display_week > 0 ? nflState.display_week : 1;
        const year = nflState.season || new Date().getFullYear();

        // Fetch Live Projections to extract Matchup Schedules
        const projRes = await fetch(`https://api.sleeper.com/projections/nfl/${year}/${week}?season_type=regular`);
        const projections = await projRes.json();

        const projMap = {};
        if (projections && projections.length) {
            for (const proj of projections) {
                let customPoints = 0;
                if (proj.stats) {
                    for (const [statKey, statValue] of Object.entries(proj.stats)) {
                        if (scoringSettings[statKey]) {
                            customPoints += statValue * scoringSettings[statKey];
                        }
                    }
                }
                
                projMap[proj.player_id] = {
                    p: customPoints,
                    opp: proj.opponent || 'BYE',
                    date: proj.date || 'TBD' 
                };
            }
        }
        
        const data = {};
        for (const id in rawPlayers) {
            const p = rawPlayers[id];
            if (!p) continue;
            
            data[id] = {
                id: p.player_id,
                fn: p.first_name,
                ln: p.last_name,
                pos: p.position,
                t: p.team || 'FA',
                wi: {}
            };

            if (projMap[id] !== undefined) {
                data[id].wi[week] = { 
                    p: projMap[id].p,
                    opp: projMap[id].opp,
                    date: projMap[id].date
                };
            }
        }
        
        try {
            localStorage.setItem(`playersInfo_${currentId}`, JSON.stringify(data));
            localStorage.setItem(`expiration_${currentId}`, (now + (24 * 3600)).toString());
        } catch (storageError) {
            localStorage.clear();
            localStorage.setItem(`playersInfo_${currentId}`, JSON.stringify(data));
            localStorage.setItem(`expiration_${currentId}`, (now + (24 * 3600)).toString());
        }

        return { players: data, stale: false };
    } catch (e) {
        console.error("Player fetch failed:", e);
        return { players: playersInfo || {}, stale: true };
    }
}