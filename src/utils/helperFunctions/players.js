import { leagueID as defaultLeagueID } from '../leagueInfo';
import { getLeagueData } from './leagueData';
import { scoreStatLine } from '../yahooScoring';

// Single definition lives in playerPool.js (dependency-free so it stays
// testable); re-exported here for the callers that already import it from this
// module.
export { playerNameKey } from '../playerPool';
import { playerNameKey } from '../playerPool';

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
    const cacheKey = `playersInfo_v11_${cacheScope}`;
    const expirationKey = `expiration_v11_${cacheScope}`;

    // Drop superseded caches: v9 was per-league (quota bloat) and v10 predates
    // the `active` flag the availability filter needs.
    try {
        Object.keys(localStorage)
            .filter(k => /^(playersInfo|expiration)_v(9|10)_/.test(k))
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

        // For a Yahoo league there's no Sleeper league to read scoring from, so
        // pull the league's real rules rather than pre-computing these cached
        // points under generic defaults -- this cache is the fallback the UI
        // uses when a live projection is unavailable, and a number scored under
        // the wrong rules is worse than an obviously missing one.
        let yahooScoring = null;
        if (isYahoo) {
            try {
                const yLeague = await getLeagueData(currentId);
                if (yLeague?.scoring_settings && Object.keys(yLeague.scoring_settings).length) {
                    yahooScoring = yLeague.scoring_settings;
                }
            } catch (e) {
                console.warn("Could not read Yahoo league scoring for player cache:", e);
            }
        }

        const scoringSettings = leagueData?.scoring_settings || yahooScoring || {
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
                // Same tested scorer the live path uses, so defense points-allowed
                // tiers and kicker field-goal distances are handled here too.
                const projPos = proj.player?.position || proj.position;
                const customPoints = scoreStatLine(proj.stats, scoringSettings, projPos) ?? 0;
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
                // Carried through so the availability filter can actually work:
                // it used to test p.active, which was never copied here and so
                // was always undefined -- letting long-retired players through.
                active: p.active !== false,
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