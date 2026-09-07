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

/**
 * Whether a platform crosswalk field (Sleeper's own espn_id/yahoo_id) is a
 * genuine id, not empty/missing/placeholder junk.
 *
 * The bug this exists to prevent is a classic JS footgun: Sleeper's own data
 * sometimes carries "0" (a non-empty STRING) as its "not mapped yet"
 * placeholder for a crosswalk field, rather than null or an empty string. A
 * plain `!!value` check treats a non-empty string as truthy no matter what it
 * says, so every player Sleeper hasn't mapped yet reads as if they all
 * legitimately own the exact same platform id (0) -- collapsing every one of
 * them onto a single dictionary slot, of which only one survives. That is a
 * standing, silent way for freshly-added players (this season's rookies
 * especially, whose crosswalk entries are the ones least likely to be filled
 * in yet) to vanish from the shared dictionary entirely, well beyond just
 * getting mislabeled.
 */
export const isRealCrosswalkId = (value) => {
    if (value === null || value === undefined) return false;
    const str = String(value).trim();
    return str !== '' && str !== '0';
};

// Sleeper's own espn_id/yahoo_id crosswalk isn't guaranteed unique -- a stale
// or duplicate mapping can give two different Sleeper players the same
// platform id. Without this check, whichever the shared dictionary builder
// (helperFunctions/players.js) processes second would silently overwrite the
// first with no signal anything went wrong -- which is how an actual active
// starter can vanish from every page's player search because an unrelated
// retired/duplicate entry happened to share their platform id and be
// processed later. Keeping the more prominent (lower searchRank) of the two
// is the same tie-break that dictionary builder's own name index already
// uses for name collisions. Defined here (not there) so it stays testable
// without that module's svelte-store/network dependencies.
export const isLessProminentDuplicate = (existing, incoming) => {
    if (!existing) return false;

    // An entry that genuinely OWNS this platform id always beats one merely
    // parked at the same key because it had no platform id of its own and
    // fell back to its Sleeper id. Both are "real players"; only one of them
    // is the player this key actually refers to on the connected platform.
    const existingOwns = !!existing.ownsPlatformId;
    const incomingOwns = !!incoming?.ownsPlatformId;
    if (existingOwns !== incomingOwns) return existingOwns;

    return (existing.searchRank ?? 999999) <= (incoming?.searchRank ?? 999999);
};

/**
 * Whether a dictionary entry found by a direct id lookup is really the player
 * that id refers to on the connected platform.
 *
 * A miss here is NOT a missing entry -- it's a wrong one. On Yahoo/ESPN the
 * dictionary is keyed by that platform's player id, falling back to the
 * Sleeper id for anyone the crosswalk doesn't cover. So a lookup by a real
 * platform id can land on a fallback-keyed player whose unrelated Sleeper id
 * happens to be the same number, and hand back a completely different person.
 * Those entries are only trustworthy when they own the id space they're
 * sitting in; everything else has to be resolved by name/team instead.
 */
export const entryOwnsLookupId = (entry) => !entry || entry.ownsPlatformId !== false;

// Generational suffixes are inconsistent between platforms -- Yahoo tends to
// carry "Michael Pittman Jr." in the full name while Sleeper's last_name is
// just "Pittman" -- so a suffix-free key is tried as a second pass.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export const playerNameKeyNoSuffix = (fn, ln) => {
    const parts = playerNameKey(fn, ln).split(' ').filter(Boolean);
    while (parts.length > 2 && NAME_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
    return parts.join(' ');
};

// Last resort for a name the platforms spell differently at the FRONT rather
// than the end: "Cam" vs "Cameron", "Mike" vs "Michael", "DJ" vs "D.J.". The
// last name plus a first initial survives all of those.
//
// Prefixed and indexed separately because it's the one match that can be
// genuinely wrong -- two real players can share a last name and initial. The
// index only keeps keys that resolve to exactly one player, so an ambiguous
// one is dropped rather than guessed at.
export const INITIAL_KEY_PREFIX = 'i:';

export const playerInitialKey = (fn, ln) => {
    const parts = playerNameKeyNoSuffix(fn, ln).split(' ').filter(Boolean);
    if (parts.length < 2) return '';
    return `${parts[0].charAt(0)} ${parts.slice(1).join(' ')}`;
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
        // `playersInfo[team]` only works while the dictionary is keyed by
        // Sleeper ids. On a Yahoo/ESPN league it's re-keyed by that platform's
        // player id, so a defense that has one is no longer under its team
        // key -- the name index carries the same alias for exactly that case.
        const byTeam = playersInfo[team] || playersByName[team];
        if (byTeam) return byTeam;
    }

    const exact = playersByName[playerNameKey(meta.fn, meta.ln)];
    if (exact) return exact;

    const noSuffix = playerNameKeyNoSuffix(meta.fn, meta.ln);
    const bySuffixFree = noSuffix && playersByName[noSuffix];
    if (bySuffixFree) return bySuffixFree;

    // Same player, different first name: the platforms disagree on "Cam" vs
    // "Cameron" far more often than on anything else. Only accepted when the
    // index found exactly one player with that last name and initial, and
    // when the positions don't contradict each other.
    const initialKey = playerInitialKey(meta.fn, meta.ln);
    const byInitial = initialKey && playersByName[`${INITIAL_KEY_PREFIX}${initialKey}`];
    if (byInitial) {
        // "BN" is what the ESPN parser returns for a position id it doesn't
        // recognise -- it means "unknown", not "bench player", and treating it
        // as a real position would reject correct matches on the strength of a
        // position we never actually read.
        const knownPos = (p) => {
            const upper = String(p || '').toUpperCase();
            return upper && upper !== 'BN' ? upper : '';
        };
        const wantPos = knownPos(pos);
        const matchedPos = knownPos(byInitial.pos);
        if (!wantPos || !matchedPos || matchedPos === wantPos) return byInitial;
    }

    return null;
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

const isDefensePos = (pos) => {
    const upper = String(pos || '').toUpperCase();
    return upper.includes('DEF') || upper === 'DST';
};

/**
 * Builds the set of ids (and optionally names) owned by any team in the league.
 *
 * `matchNames` should only be enabled where ids genuinely can't be trusted to
 * line up -- see the note at the top of this file. Defenses are the one case
 * even name-matching can't bridge reliably: Yahoo's full team name ("San
 * Francisco 49ers") and Sleeper's own dictionary naming for the same defense
 * don't consistently agree, while both platforms DO agree on the team
 * abbreviation -- so that's indexed separately.
 */
export const buildOwnedIndex = (rosters, { matchNames = false, nameSources = [] } = {}) => {
    const ids = new Set();
    const names = new Set();
    const defTeams = new Set();

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
                    let nameFound = false;
                    for (const source of nameSources) {
                        const meta = source?.[key];
                        if (!meta) continue;

                        if (isDefensePos(meta.pos ?? meta.position)) {
                            const team = String(meta.t ?? meta.team ?? '').toUpperCase();
                            if (team) defTeams.add(team);
                        }

                        if (!nameFound) {
                            const fn = meta.fn ?? meta.first_name;
                            const ln = meta.ln ?? meta.last_name;
                            const nameKey = playerNameKey(fn, ln);
                            if (nameKey) {
                                names.add(nameKey);
                                // Suffix-free too -- a rostered "Michael Pittman Jr."
                                // must still match a dictionary entry whose last_name
                                // is bare "Pittman" (see the module note up top), or
                                // this index silently fails to cover that player at
                                // all and they leak through as available.
                                const noSuffix = playerNameKeyNoSuffix(fn, ln);
                                if (noSuffix) names.add(noSuffix);
                                nameFound = true;
                            }
                        }
                    }
                });
            });
        });
    }

    return { ids, names, defTeams, isEmpty: ids.size === 0 };
};

/**
 * True when this player is rostered by someone in the league.
 * Checks the player's own id and its crosswalked sleeper_id, its team
 * abbreviation for a defense, and its name when the index was built with
 * name matching enabled.
 */
export const isPlayerOwned = (player, ownedIndex) => {
    if (!player || !ownedIndex) return false;

    const candidateIds = [player.player_id, player.id, player.sleeper_id];
    for (const candidate of candidateIds) {
        if (candidate !== null && candidate !== undefined && ownedIndex.ids.has(String(candidate))) {
            return true;
        }
    }

    if (ownedIndex.defTeams?.size && isDefensePos(player.pos ?? player.position)) {
        const team = String(player.t ?? player.team ?? '').toUpperCase();
        if (team && ownedIndex.defTeams.has(team)) return true;
    }

    if (!ownedIndex.names.size) return false;
    const fn = player.fn ?? player.first_name;
    const ln = player.ln ?? player.last_name;
    const nameKey = playerNameKey(fn, ln);
    if (nameKey && ownedIndex.names.has(nameKey)) return true;
    const noSuffix = playerNameKeyNoSuffix(fn, ln);
    return noSuffix ? ownedIndex.names.has(noSuffix) : false;
};

/**
 * Independent, index-free check for whether a name genuinely has nobody in
 * the dictionary, or whether an entry exists but the pre-built name index
 * (playersByName) missed it -- two very different problems with the same
 * symptom ("unresolved"), that a coverage percentage can't tell apart.
 *
 * Scans playersInfo directly rather than going through playerNameKey/
 * playersByName at all, so a bug in either of those can't hide behind this
 * check agreeing with them. Matches on last name alone (case-insensitive,
 * substring) since that catches a first-name spelling difference too, at the
 * cost of a few unrelated same-surname players in a large dictionary --
 * acceptable for a diagnostic that exists to be read by a person, not acted
 * on by code.
 */
export const findByLastNameRaw = (lastName, playersInfo) => {
    const needle = String(lastName || '').toLowerCase().trim();
    if (!needle) return [];

    return Object.entries(playersInfo || {})
        .filter(([, p]) => p && String(p.ln || p.last_name || '').toLowerCase().includes(needle))
        .map(([id, p]) => ({ id, fn: p.fn || p.first_name, ln: p.ln || p.last_name, pos: p.pos || p.position }))
        .slice(0, 5);
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
    // Who couldn't be identified, not just how many. A coverage number says a
    // roster has a hole in it; the names say WHY, which is the difference
    // between a fixable matching gap and a player the dictionary genuinely
    // doesn't have.
    const unresolvedNames = [];
    // The same failures as unresolvedNames, but as data (id/fn/ln/pos) rather
    // than a formatted string -- so a caller can run its own follow-up check
    // (e.g. an index-independent name scan) without re-parsing the label.
    const unresolvedMeta = [];
    let unresolved = 0;

    ids.forEach(pId => {
        if (pId === null || pId === undefined || pId === '0') return;

        const direct = playersInfo[pId] || playersInfo[String(pId)];
        // A direct hit on someone who doesn't own this id space is a
        // coincidence, not a match -- resolve by name/team below instead of
        // silently crediting this roster with a stranger's projections.
        if (direct && entryOwnsLookupId(direct)) { players.push(direct); return; }

        const meta = platformMeta[pId] || platformMeta[String(pId)];
        const matched = meta ? resolvePlayerFromMeta(meta, playersInfo, playersByName) : null;
        if (matched) { players.push(matched); return; }

        unresolved++;
        const label = meta ? `${meta.fn || ''} ${meta.ln || ''}`.trim() : '';
        unresolvedNames.push(label ? `${label} (${meta.pos || '?'}, id ${pId})` : `id ${pId}`);
        unresolvedMeta.push({ id: pId, fn: meta?.fn || null, ln: meta?.ln || null, pos: meta?.pos || null });
    });

    const total = players.length + unresolved;
    return { players, unresolved, unresolvedNames, unresolvedMeta, coverage: total ? players.length / total : 1 };
};
