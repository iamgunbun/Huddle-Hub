import { leagueID as defaultLeagueID } from '../leagueInfo';
import { getLeagueData } from './leagueData';
import { scoreStatLine } from '../yahooScoring';
import { isYahooLeagueId, isEspnLeagueId } from '../platformIds';

// Single definition lives in playerPool.js (dependency-free so it stays
// testable); re-exported here for the callers that already import it from this
// module.
export { playerNameKey, isLessProminentDuplicate } from '../playerPool';
import { playerNameKey, playerNameKeyNoSuffix, isLessProminentDuplicate } from '../playerPool';

const buildNameIndex = (data) => {
    const byName = {};
    Object.values(data || {}).forEach(p => {
        if (!p) return;

        // Team defenses are also indexed under their team abbreviation.
        //
        // Sleeper keys a defense by its team ("SF"), and every cross-platform
        // lookup for one joins on that abbreviation -- it's the only thing the
        // platforms agree on, since a defense shares no player id and the
        // naming never lines up. But on a Yahoo/ESPN league the dictionary is
        // re-keyed by that platform's id, so a defense carrying one moves out
        // from under its team key and those lookups quietly stop finding it,
        // leaving a hole in every roster that owns one. This index is
        // lookup-only (never enumerated as a player list), so it's the safe
        // place to put the alias.
        const defenseTeam = p.pos === 'DEF' ? String(p.t || '').toUpperCase() : '';
        if (defenseTeam && !byName[defenseTeam]) byName[defenseTeam] = p;

        const rank = p.searchRank || 999999;
        // Indexed under both the exact name and a suffix-free variant, since the
        // platforms disagree about whether "Jr."/"III" is part of the name.
        [playerNameKey(p.fn, p.ln), playerNameKeyNoSuffix(p.fn, p.ln)].forEach(key => {
            if (!key) return;
            const existing = byName[key];
            // On a name collision, keep the more prominent player (lower searchRank).
            if (!existing || rank < (existing.searchRank || 999999)) byName[key] = p;
        });
    });
    return byName;
};

export const loadPlayers = async (activeLeagueId) => {
    const currentId = activeLeagueId || defaultLeagueID;
    const now = Math.round(new Date().getTime() / 1000);
    
    // Automatically detect if the active league is Yahoo or ESPN.
    const isYahoo = isYahooLeagueId(currentId);
    // ESPN ids are shape-identical to Sleeper ids, so they're disambiguated by
    // an in-app "espn:" prefix (see platformIds.js) rather than by shape.
    const isEspn = isEspnLeagueId(currentId);

    if (!currentId || currentId === 'default_id' || currentId === 'undefined') {
        return { players: {}, playersByName: {}, stale: true };
    }

    // The player database is identical for every league -- only the ID scheme it
    // gets keyed by differs (Yahoo ids vs ESPN ids vs Sleeper ids). v9 keyed this
    // cache per league, so each additional league wrote another multi-megabyte
    // copy of essentially the same data and pushed localStorage past its ~5MB
    // quota. Scoping the cache to the ID scheme caps it at three copies instead
    // of N, and keeps an ESPN league from silently reading back a Yahoo-keyed
    // cache (or vice versa) when a user switches between them.
    const cacheScope = isEspn ? 'espn' : (isYahoo ? 'yahoo' : 'sleeper');
    const cacheKey = `playersInfo_v12_${cacheScope}`;
    const expirationKey = `expiration_v12_${cacheScope}`;

    // Drop superseded caches: v9 was per-league (quota bloat), v10 predates the
    // `active` flag the availability filter needs, and v11 predates
    // `ownsPlatformId` -- without which every entry reads as a stand-in.
    try {
        Object.keys(localStorage)
            .filter(k => /^(playersInfo|expiration)_v(9|10|11)_/.test(k))
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

        // ONLY fetch league data from Sleeper if it's a native Sleeper league id
        const isExternalPlatform = isYahoo || isEspn;
        if (!isExternalPlatform) {
            promises.push(fetch(`https://api.sleeper.app/v1/league/${currentId}`));
        }

        const responses = await Promise.all(promises);

        const sleeperRes = responses[0];
        const stateRes = responses[1];
        const leagueRes = !isExternalPlatform ? responses[2] : null;

        if (!isExternalPlatform && (!leagueRes || !leagueRes.ok)) {
            return { players: playersInfo || {}, playersByName: buildNameIndex(playersInfo), stale: true };
        }

        const rawPlayers = await sleeperRes.json();
        const nflState = await stateRes.json();
        const leagueData = leagueRes ? await leagueRes.json() : null;

        // For a Yahoo or ESPN league there's no Sleeper league to read scoring
        // from, so pull the league's real rules rather than pre-computing these
        // cached points under generic defaults -- this cache is the fallback the
        // UI uses when a live projection is unavailable, and a number scored
        // under the wrong rules is worse than an obviously missing one.
        let yahooScoring = null;
        if (isExternalPlatform) {
            try {
                const extLeague = await getLeagueData(currentId);
                if (extLeague?.scoring_settings && Object.keys(extLeague.scoring_settings).length) {
                    yahooScoring = extLeague.scoring_settings;
                }
            } catch (e) {
                console.warn("Could not read external league scoring for player cache:", e);
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
            // PLATFORM ID MAPPING ENGINE
            // ==========================================
            // Force the platform's own player id into the primary dictionary
            // key when viewing a league on that platform, so its rosters (which
            // only know their own ids) can look players up directly.
            let primaryId = p.player_id;
            // Whether this key is really this player's id ON THE CONNECTED
            // PLATFORM, or just their Sleeper id standing in because the
            // crosswalk has nothing. A lookup by a real platform id that lands
            // on a stand-in is a wrong player, not a missing one -- see
            // entryOwnsLookupId.
            let ownsPlatformId = true;
            if (isYahoo) {
                ownsPlatformId = !!p.yahoo_id;
                primaryId = String(p.yahoo_id || p.player_id);
            } else if (isEspn) {
                ownsPlatformId = !!p.espn_id;
                primaryId = String(p.espn_id || p.player_id);
            }

            const playerObj = {
                id: primaryId,
                ownsPlatformId,
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

            if (isLessProminentDuplicate(data[primaryId], playerObj)) continue;

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