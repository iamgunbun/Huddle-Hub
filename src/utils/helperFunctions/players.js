import { leagueID as defaultLeagueID } from '../leagueInfo';

export const loadPlayers = async (activeLeagueId) => {
    const currentId = activeLeagueId || defaultLeagueID;
    const now = Math.round(new Date().getTime() / 1000);
    
    // Automatically detect if the active league is Yahoo
    const isYahoo = currentId && (String(currentId).includes('.') || !/^\d+$/.test(String(currentId)));
    
    if (!currentId || currentId === 'default_id' || currentId === 'undefined') {
        return { players: {}, stale: true };
    }
    
    let playersInfo = null;
    let expiration = null;
    
    try {
        // v8 cache key forces the browser to discard the Sleeper cache and map the new Yahoo IDs
        playersInfo = JSON.parse(localStorage.getItem(`playersInfo_v8_${currentId}`));
        expiration = parseInt(localStorage.getItem(`expiration_v8_${currentId}`));
    } catch (e) {
        console.warn("Failed to read local player cache safely:", e);
    }

    if (playersInfo && expiration && now < expiration) {
        return { players: playersInfo, stale: false };
    }

    try {
        const promises = [
            fetch("https://api.sleeper.app/v1/players/nfl"),
            fetch("https://api.sleeper.app/v1/state/nfl")
        ];

        // ONLY fetch league data from Sleeper if it is NOT a Yahoo ID
        if (!isYahoo) {
            promises.push(fetch(`https://api.sleeper.app/v1/league/${currentId}`));
        }

        const responses = await Promise.all(promises);
        
        const sleeperRes = responses[0];
        const stateRes = responses[1];
        const leagueRes = !isYahoo ? responses[2] : null;
        
        if (!isYahoo && (!leagueRes || !leagueRes.ok)) {
            return { players: playersInfo || {}, stale: true };
        }
        
        const rawPlayers = await sleeperRes.json();
        const nflState = await stateRes.json();
        const leagueData = leagueRes ? await leagueRes.json() : null;
        
        const scoringSettings = leagueData?.scoring_settings || {
            pass_yd: 0.04, pass_td: 4, pass_int: -1,
            rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6, rec: 0.5,
            fum_lost: -2, fum: -1
        };
        
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
                // Projections natively map to the standard Sleeper ID
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
            
            // ==========================================
            // YAHOO ID MAPPING ENGINE 
            // ==========================================
            // Force Yahoo IDs into the primary dictionary key if the user is viewing a Yahoo League
            let primaryId = p.player_id;
            if (isYahoo) {
                primaryId = String(p.yahoo_id || p.player_id);
            }

            const playerObj = {
                id: primaryId,
                sleeper_id: p.player_id,
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
                status: p.status || 'Active',
                injStatus: p.injury_status || null,
                injNotes: p.injury_notes || null,
                searchRank: p.search_rank || 999999, 
                posRank: 999999 
            };

            // Link projections directly to the original sleeper ID
            if (projMap[p.player_id] !== undefined) {
                playerObj.wi[week] = { 
                    p: projMap[p.player_id].p,
                    opp: projMap[p.player_id].opp,
                    date: projMap[p.player_id].date
                };
            }

            data[primaryId] = playerObj;

            if (p.position) {
                if (!posGroups[p.position]) posGroups[p.position] = [];
                posGroups[p.position].push(playerObj);
            }
        }

        Object.values(posGroups).forEach(group => {
            group.sort((a, b) => a.searchRank - b.searchRank);
            group.forEach((p, idx) => {
                data[p.id].posRank = idx + 1;
            });
        });
        
        try {
            localStorage.setItem(`playersInfo_v8_${currentId}`, JSON.stringify(data));
            localStorage.setItem(`expiration_v8_${currentId}`, (now + (24 * 3600)).toString());
        } catch (storageError) {
            localStorage.clear();
            localStorage.setItem(`playersInfo_v8_${currentId}`, JSON.stringify(data));
            localStorage.setItem(`expiration_v8_${currentId}`, (now + (24 * 3600)).toString());
        }

        return { players: data, stale: false };
    } catch (e) {
        console.error("Player fetch failed:", e);
        return { players: playersInfo || {}, stale: true };
    }
};