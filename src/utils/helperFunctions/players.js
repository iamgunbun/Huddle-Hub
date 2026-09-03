import { leagueID as defaultLeagueID } from '../leagueInfo';

// Normalized "first last" key, used to reconcile a player across platforms when
// an ID crosswalk isn't available -- Yahoo rosters routinely include players
// Sleeper's yahoo_id mapping doesn't cover, and those still need projections.
export const playerNameKey = (fn, ln) =>
    `${fn || ''} ${ln || ''}`.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

const buildNameIndex = (data) => {
    const byName = {};
    Object.values(data || {}).forEach(p => {
        if (!p) return;
        const key = playerNameKey(p.fn, p.ln);
        if (!key) return;
        const existing = byName[key];
        // On a name collision, keep the more prominent player (lower searchRank).
        if (!existing || (p.searchRank || 999999) < (existing.searchRank || 999999)) {
            byName[key] = p;
        }
    });
    return byName;
};

export const loadPlayers = async (activeLeagueId) => {
    const currentId = activeLeagueId || defaultLeagueID;
    const now = Math.round(new Date().getTime() / 1000);
    
    // Automatically detect if the active league is Yahoo
    const isYahoo = currentId && (String(currentId).includes('.') || !/^\d+$/.test(String(currentId)));
    
    if (!currentId || currentId === 'default_id' || currentId === 'undefined') {
        return { players: {}, playersByName: {}, stale: true };
    }
    
    // The player database is identical for every league -- only the ID scheme it
    // gets keyed by differs (Yahoo ids vs Sleeper ids). v9 keyed this cache per
    // league, so each additional league wrote another multi-megabyte copy of
    // essentially the same data and pushed localStorage past its ~5MB quota.
    // Scoping the cache to the ID scheme caps it at two copies instead of N.
    const cacheScope = isYahoo ? 'yahoo' : 'sleeper';
    const cacheKey = `playersInfo_v10_${cacheScope}`;
    const expirationKey = `expiration_v10_${cacheScope}`;

    // Clear out the per-league v9 entries that are still occupying quota.
    try {
        Object.keys(localStorage)
            .filter(k => k.startsWith('playersInfo_v9_') || k.startsWith('expiration_v9_'))
            .forEach(k => localStorage.removeItem(k));
    } catch (e) {
        console.warn("Failed to prune legacy player caches:", e);
    }

    let playersInfo = null;
    let expiration = null;

    try {
        playersInfo = JSON.parse(localStorage.getItem(cacheKey));
        expiration = parseInt(localStorage.getItem(expirationKey));
    } catch (e) {
        console.warn("Failed to read local player cache safely:", e);
    }

    if (playersInfo && expiration && now < expiration) {
        return { players: playersInfo, playersByName: buildNameIndex(playersInfo), stale: false };
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
            return { players: playersInfo || {}, playersByName: buildNameIndex(playersInfo), stale: true };
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
        
        // NEVER localStorage.clear() here. Supabase keeps the auth session in
        // localStorage alongside this cache, so clearing it silently signs the
        // user out (and drops the active league) the moment the player database
        // doesn't fit -- which is what made switching leagues force a re-login.
        // On a quota error, evict only our own player caches; if it still won't
        // fit, run without a cache rather than touching anyone else's keys.
        const writeCache = () => {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(expirationKey, (now + (24 * 3600)).toString());
        };

        try {
            writeCache();
        } catch {
            try {
                Object.keys(localStorage)
                    .filter(k => k.startsWith('playersInfo_') || k.startsWith('expiration_'))
                    .forEach(k => localStorage.removeItem(k));
                writeCache();
            } catch (retryError) {
                console.warn("Player cache skipped -- localStorage quota exceeded:", retryError);
            }
        }

        return { players: data, playersByName: buildNameIndex(data), stale: false };
    } catch (e) {
        console.error("Player fetch failed:", e);
        return { players: playersInfo || {}, playersByName: buildNameIndex(playersInfo), stale: true };
    }
};