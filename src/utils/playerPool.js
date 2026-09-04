// Working out which players are actually available in a league's pool.
//
// "Available" means: not rostered by any team in this league. The subtlety is
// that roster entries and the player dictionary don't always agree on an id --
// a Yahoo league's rosters carry Yahoo ids while the dictionary falls back to
// Sleeper ids for any player Yahoo's crosswalk doesn't cover -- so matching on
// id alone lets rostered players leak through. Names are used as a second key.

// Normalized "first last" key, used to reconcile a player across platforms when
// an ID crosswalk isn't available. Defined here rather than alongside the player
// loader so this module stays dependency-free and directly testable.
export const playerNameKey = (fn, ln) =>
    `${fn || ''} ${ln || ''}`.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// Every field a roster can park a rostered player in. `players` is meant to be
// the full list, but starters/reserve/taxi are included so a platform that
// splits them out (or omits one) can't hide an owned player.
const ROSTER_PLAYER_FIELDS = ['players', 'starters', 'reserve', 'taxi'];

/**
 * Builds the set of ids and names owned by any team in the league.
 * `nameSources` are id -> {fn, ln} maps used to resolve a roster id to a name
 * (Yahoo's roster metadata, and the player dictionary).
 */
export const buildOwnedIndex = (rosters, ...nameSources) => {
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
 * Checks the player's own id, its crosswalked sleeper_id, and its name, since
 * any one of those may be the form the roster recorded.
 */
export const isPlayerOwned = (player, ownedIndex) => {
    if (!player || !ownedIndex) return false;

    const candidateIds = [player.player_id, player.id, player.sleeper_id];
    for (const candidate of candidateIds) {
        if (candidate !== null && candidate !== undefined && ownedIndex.ids.has(String(candidate))) {
            return true;
        }
    }

    const nameKey = playerNameKey(player.fn ?? player.first_name, player.ln ?? player.last_name);
    return nameKey ? ownedIndex.names.has(nameKey) : false;
};
