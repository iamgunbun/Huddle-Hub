import { leagueID as defaultLeagueID } from '../leagueInfo';

export const loadPlayers = async (activeLeagueId) => {
    const currentId = activeLeagueId || defaultLeagueID;
    const now = Math.round(new Date().getTime() / 1000);
    
    if (!currentId || currentId === 'default_id' || currentId === 'undefined') {
        return { players: {}, stale: true };
    }
    
    let playersInfo = null;
    let expiration = null;
    
    try {
        // BUMPED TO v5: Forces browser to delete the old cache and map the new rankings & status fields
        playersInfo = JSON.parse(localStorage.getItem(`playersInfo_v5_${currentId}`));
        expiration = parseInt(localStorage.getItem(`expiration_v5_${currentId}`));
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
            return { players: playersInfo || {}, stale: true };
        }
        
        const rawPlayers = await sleeperRes.json();
        const leagueData = await leagueRes.json();
        const nflState = await stateRes.json();
        
        const scoringSettings = leagueData?.scoring_settings || {};
        const week = nflState.display_week > 0 ? nflState.display_week : 1;
        const year = nflState.season || new Date().getFullYear();

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
        const posGroups = {};

        for (const id in rawPlayers) {
            const p = rawPlayers[id];
            if (!p) continue;
            
            const playerObj = {
                id: p.player_id,
                fn: p.first_name,
                ln: p.last_name,
                pos: p.position,
                t: p.team || 'FA',
                espn_id: p.espn_id || null,
                age: p.age || '-',
                ht: p.height || '-',
                wt: p.weight || '-',
                exp: p.years_exp || 0,
                college: p.college || '-',
                wi: {},
                // Capture Native Sleeper Status & Rankings
                status: p.status || 'Active',
                injStatus: p.injury_status || null,
                injNotes: p.injury_notes || null,
                searchRank: p.search_rank || 999999, 
                posRank: 999999 
            };

            if (projMap[id] !== undefined) {
                playerObj.wi[week] = { 
                    p: projMap[id].p,
                    opp: projMap[id].opp,
                    date: projMap[id].date
                };
            }

            data[id] = playerObj;

            if (p.position) {
                if (!posGroups[p.position]) posGroups[p.position] = [];
                posGroups[p.position].push(playerObj);
            }
        }

        // Calculate Positional Rankings based on Sleeper's Overall Search Rank
        Object.values(posGroups).forEach(group => {
            group.sort((a, b) => a.searchRank - b.searchRank);
            group.forEach((p, idx) => {
                data[p.id].posRank = idx + 1;
            });
        });
        
        try {
            localStorage.setItem(`playersInfo_v5_${currentId}`, JSON.stringify(data));
            localStorage.setItem(`expiration_v5_${currentId}`, (now + (24 * 3600)).toString());
        } catch (storageError) {
            localStorage.clear();
            localStorage.setItem(`playersInfo_v5_${currentId}`, JSON.stringify(data));
            localStorage.setItem(`expiration_v5_${currentId}`, (now + (24 * 3600)).toString());
        }

        return { players: data, stale: false };
    } catch (e) {
        console.error("Player fetch failed:", e);
        return { players: playersInfo || {}, stale: true };
    }
};