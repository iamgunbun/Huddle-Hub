// Working out which players are actually available in a league's pool.
//
// "Available" means: on an NFL roster right now, and not rostered by any team
// in this league.
//
// Two separate problems live here:
//
// 1. Matching a roster entry to a dictionary entry. Sleeper leagues are exact --
//    both sides use Sleeper ids. Yahoo leagues are not: rosters carry Yahoo ids
//    while the dictionary falls back to a Sleeper id for any player Yahoo's
//    crosswalk doesn't cover, so ids alone let rostered players leak through.
//    Names bridge that gap -- but only where it exists. Applying name matching
//    to Sleeper adds nothing (ids already match) and can only cause false
//    positives, hiding an available player who shares a name with a rostered
//    one. So name matching is opt-in.
//
// 2. The dictionary is every player Sleeper has ever known, including the long
//    retired. Those are not available in any meaningful sense.

// Normalized "first last" key, used to reconcile a player across platforms when
// an ID crosswalk isn't available. Defined here rather than alongside the player
// loader so this module stays dependency-free and directly testable.
export const playerNameKey = (fn, ln) =>
    `${fn || ''} ${ln || ''}`.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// Generational suffixes are inconsistent between platforms -- Yahoo tends to
// carry "Michael Pittman Jr." in the full name while Sleeper's last_name is
// just "Pittman" -- so a suffix-free key is tried as a second pass.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export const playerNameKeyNoSuffix = (fn, ln) => {
    const parts = playerNameKey(fn, ln).split(' ').filter(Boolean);
    while (parts.length > 2 && NAME_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
    return parts.join(' ');
};

/**
 * Resolves a player the league's roster referred to, given whatever metadata the
 * platform supplied alongside it, against the shared player dictionary.
 *
 * Team defenses are the case that needs special handling: Sleeper keys them by
 * team abbreviation ("SF") and gives them no yahoo_id, so a Yahoo league's
 * numeric defense id can never match by id, and the names don't line up either
 * ("San Francisco" vs Sleeper's own wording). The team abbreviation is the one
 * thing both platforms agree on.
 */
export const resolvePlayerFromMeta = (meta, playersInfo = {}, playersByName = {}) => {
    if (!meta) return null;

    const pos = String(meta.pos || '').toUpperCase();
    const team = String(meta.t || meta.team || '').toUpperCase().trim();

    if (pos.includes('DEF') || pos === 'DST') {
        const byTeam = playersInfo[team];
        if (byTeam) return byTeam;
    }

    const exact = playersByName[playerNameKey(meta.fn, meta.ln)];
    if (exact) return exact;

    const noSuffix = playerNameKeyNoSuffix(meta.fn, meta.ln);
    return (noSuffix && playersByName[noSuffix]) || null;
};

export const NFL_TEAMS = new Set([
    'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
    'HOU', 'IND', 'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
    'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WAS',
]);

// Statuses that mean the player isn't on an NFL roster.
const OFF_ROSTER_STATUSES = new Set([
    'inactive', 'retired', 'non retained', 'not with team', 'free agent', 'nfl',
]);

/**
 * True when this player is on an NFL roster right now.
 *
 * Being on a team is the load-bearing check: Sleeper leaves `team` null for
 * anyone not currently rostered in the NFL, which is what separates a real
 * waiver-wire option from a player who retired years ago.
 */
export const isRosterableNflPlayer = (player) => {
    if (!player) return false;
    if (player.active === false) return false;

    const status = String(player.status || '').toLowerCase().trim();
    if (OFF_ROSTER_STATUSES.has(status)) return false;

    const team = String(player.t || player.team || '').toUpperCase().trim();
    return NFL_TEAMS.has(team);
};

// Every field a roster can park a rostered player in. `players` is meant to be
// the full list, but starters/reserve/taxi are included so a platform that
// splits them out (or omits one) can't hide an owned player.
const ROSTER_PLAYER_FIELDS = ['players', 'starters', 'reserve', 'taxi'];

/**
 * Builds the set of ids (and optionally names) owned by any team in the league.
 *
 * `matchNames` should only be enabled where ids genuinely can't be trusted to
 * line up -- see the note at the top of this file.
 */
export const buildOwnedIndex = (rosters, { matchNames = false, nameSources = [] } = {}) => {
    const ids = new Set();
    const names = new Set();

    if (rosters && typeof rosters === 'object') {
        Object.values(rosters).forEach(roster => {
            if (!roster || typeof roster !== 'object') return;

            ROSTER_PLAYER_FIELDS.forEach(field => {
                const list = roster[field];
                if (!Array.isArray(list)) return;

                list.forEach(rawId => {
                    if (rawId === null || rawId === undefined || rawId === '0') return;
                    const key = String(rawId);
                    ids.add(key);

                    if (!matchNames) return;
                    for (const source of nameSources) {
                        const meta = source?.[key];
                        const nameKey = meta ? playerNameKey(meta.fn ?? meta.first_name, meta.ln ?? meta.last_name) : '';
                        if (nameKey) {
                            names.add(nameKey);
                            break;
                        }
                    }
                });
            });
        });
    }

    return { ids, names, isEmpty: ids.size === 0 };
};

/**
 * True when this player is rostered by someone in the league.
 * Checks the player's own id and its crosswalked sleeper_id, plus its name when
 * the index was built with name matching enabled.
 */
export const isPlayerOwned = (player, ownedIndex) => {
    if (!player || !ownedIndex) return false;

    const candidateIds = [player.player_id, player.id, player.sleeper_id];
    for (const candidate of candidateIds) {
        if (candidate !== null && candidate !== undefined && ownedIndex.ids.has(String(candidate))) {
            return true;
        }
    }

    if (!ownedIndex.names.size) return false;
    const nameKey = playerNameKey(player.fn ?? player.first_name, player.ln ?? player.last_name);
    return nameKey ? ownedIndex.names.has(nameKey) : false;
};

/**
 * Folds a platform's own player details into the shared dictionary.
 *
 * In a Yahoo league every id in a roster, draft or transaction is a Yahoo id,
 * while the shared dictionary is keyed by Sleeper's community-maintained
 * crosswalk. Anything the crosswalk misses has no name, position or team at
 * all -- which is how a transaction ends up reading "Player #40877".
 *
 * The platform's own details are authoritative for who the player IS, so they
 * win; the dictionary is still consulted by name to recover a sleeper_id, which
 * is the only thing that makes the headshot resolve.
 */
export const withResolvedPlayerMeta = (playersInfo, playersByName, platformMeta) => {
    const merged = { ...(playersInfo || {}) };

    Object.entries(platformMeta || {}).forEach(([id, meta]) => {
        if (!meta) return;
        const matched = resolvePlayerFromMeta(meta, playersInfo, playersByName);
        merged[id] = matched
            ? { ...matched, ...meta, sleeper_id: matched.sleeper_id }
            : { ...meta, sleeper_id: null };
    });

    return merged;
};

/**
 * The dictionary entries for a roster's players.
 *
 * The subtle failure this exists to prevent: in a Yahoo league the roster holds
 * Yahoo ids while the dictionary is keyed by Sleeper's crosswalk, so a plain
 * lookup silently DROPS every player the crosswalk misses. A power ranking built
 * that way measures how much of each roster happened to be crosswalked rather
 * than how good it is -- and since that fraction differs per team, it invents a
 * huge spread out of nothing.
 *
 * The platform's own metadata bridges the gap by name. Dictionary entries are
 * returned (not the metadata) because only those carry the weekly projections a
 * strength estimate is built from.
 *
 * Also reports coverage, so a caller can tell "this roster is weak" apart from
 * "most of this roster couldn't be identified".
 */
export const resolveRosterPlayers = (playerIds, playersInfo = {}, playersByName = {}, platformMeta = {}) => {
    const ids = playerIds || [];
    const players = [];
    let unresolved = 0;

    ids.forEach(pId => {
        if (pId === null || pId === undefined || pId === '0') return;

        const direct = playersInfo[pId] || playersInfo[String(pId)];
        if (direct) { players.push(direct); return; }

        const meta = platformMeta[pId] || platformMeta[String(pId)];
        const matched = meta ? resolvePlayerFromMeta(meta, playersInfo, playersByName) : null;
        if (matched) players.push(matched);
        else unresolved++;
    });

    const total = players.length + unresolved;
    return { players, unresolved, coverage: total ? players.length / total : 1 };
};
