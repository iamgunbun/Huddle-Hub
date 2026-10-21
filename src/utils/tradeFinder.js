// Finds trades that help BOTH sides, from roster shape alone.
//
// WHY THIS NEEDS NO "WANTS AND NEEDS" SURVEY
// ------------------------------------------
// A team's need at a position is not an opinion, it is a consequence of its
// starting lineup. The value of a player to a team is how much he raises that
// team's best possible lineup -- so an RB3 on a team that starts two RBs and a
// FLEX is worth close to nothing to his owner, and the same player is worth
// real points to a team starting a replacement-level back. Subtracting the two
// lineups before and after a swap measures exactly that, which means surplus
// and need fall out of the arithmetic instead of having to be declared by
// anybody. A trade is worth proposing only when both sides' lineups improve.
//
// Deliberately pure: no network, no React, and `valueOf` is injected, so the
// ranking can be checked against hand-worked examples (see
// scripts/verify-trade-finder.mjs) rather than against whatever the projection
// feed happens to say today.

/**
 * Which positions may fill each lineup slot.
 *
 * The vocabulary is the one the platform adapters already normalise to --
 * Sleeper's own slot names, which espnParsers.js and yahooHistory.js both map
 * onto (ESPN slot 23 and Yahoo's "W/R/T" are both FLEX here).
 */
export const SLOT_ELIGIBILITY = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
    DL: ['DL'], LB: ['LB'], DB: ['DB'],
    FLEX: ['RB', 'WR', 'TE'],
    WRRB_FLEX: ['RB', 'WR'],
    REC_FLEX: ['WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    IDP_FLEX: ['DL', 'LB', 'DB'],
    IDP: ['DL', 'LB', 'DB'],
};

const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI']);

/** The slots a lineup actually scores from -- bench and IR never do. */
export const startingSlots = (rosterPositions) =>
    (rosterPositions || []).filter(s => s && !BENCH_SLOTS.has(s) && SLOT_ELIGIBILITY[s]);

/**
 * Rest-of-season value: the player's remaining projected points.
 *
 * Returns null -- NOT zero -- when the feed has no projection for him. That
 * distinction is the whole guard: a crosswalk gap on a Yahoo or ESPN league
 * leaves a real starter with no `wi` entry, and scoring him as 0 would make
 * this tool offer up the best player on the roster for a backup tight end,
 * confidently and in writing. Callers must exclude nulls and say so.
 */
export const rosValue = (player, weeks) => {
    if (!player || !Array.isArray(weeks) || !weeks.length) return null;
    let total = 0;
    let seen = 0;
    weeks.forEach(w => {
        const p = player?.wi?.[w]?.p;
        const n = typeof p === 'string' ? parseFloat(p) : p;
        if (Number.isFinite(n)) { total += n; seen++; }
    });
    return seen ? Math.round(total * 100) / 100 : null;
};

/** A value function over a fixed set of weeks, for the common case. */
export const makeRosValue = (weeks) => (player) => rosValue(player, weeks);

/**
 * The best lineup a set of players can field, and what it scores.
 *
 * Slots are filled MOST RESTRICTIVE FIRST rather than in the order
 * roster_positions happens to list them. Filling in array order is only
 * correct while the strict slots come before the flex ones; a league that
 * lists FLEX early would have it swallow the best running back, and then the
 * RB slot below it takes a worse player than it should. Sorting by how few
 * positions a slot accepts removes that dependency -- and because the flex
 * families here are nested (QB is a subset of SUPER_FLEX, RB/WR/TE of FLEX),
 * greedy assignment in that order is optimal, not just a heuristic.
 */
export const optimalLineup = (players, slots, valueOf) => {
    const pool = (players || [])
        .map(p => ({ player: p, pos: p?.pos, value: valueOf(p) }))
        .filter(e => e.pos && Number.isFinite(e.value))
        .sort((a, b) => b.value - a.value);

    const order = startingSlots(slots)
        .map((slot, i) => ({ slot, i, width: SLOT_ELIGIBILITY[slot].length }))
        .sort((a, b) => a.width - b.width || a.i - b.i);

    const taken = new Set();
    const filled = [];
    let score = 0;

    order.forEach(({ slot }) => {
        const eligible = SLOT_ELIGIBILITY[slot];
        const idx = pool.findIndex((e, i) => !taken.has(i) && eligible.includes(e.pos));
        // A slot with nobody eligible scores zero rather than throwing: a
        // roster mid-trade can genuinely be short at a position.
        if (idx === -1) { filled.push({ slot, player: null, value: 0 }); return; }
        taken.add(idx);
        score += pool[idx].value;
        filled.push({ slot, player: pool[idx].player, value: pool[idx].value });
    });

    return { score: Math.round(score * 100) / 100, filled };
};

/**
 * How much a swap raises (or lowers) one team's best lineup.
 *
 * This is the number that encodes "need": positive means the trade makes
 * their starting lineup better, whatever their roster looked like going in.
 */
export const lineupGain = ({ players, give = [], get = [], slots, valueOf }) => {
    const before = optimalLineup(players, slots, valueOf).score;
    const gone = new Set(give);
    const after = optimalLineup(
        (players || []).filter(p => !gone.has(p)).concat(get),
        slots, valueOf
    ).score;
    return Math.round((after - before) * 100) / 100;
};

/** Every k-sized combination of a list, k small. */
const combinations = (arr, k) => {
    if (k <= 0 || k > arr.length) return [];
    if (k === 1) return arr.map(x => [x]);
    const out = [];
    for (let i = 0; i <= arr.length - k; i++) {
        combinations(arr.slice(i + 1), k - 1).forEach(rest => out.push([arr[i], ...rest]));
    }
    return out;
};

const packages = (players, max) => {
    const out = [];
    for (let k = 1; k <= max; k++) out.push(...combinations(players, k));
    return out;
};

const sumValue = (players, valueOf) =>
    players.reduce((t, p) => t + (valueOf(p) || 0), 0);

/** The positions a manager can put on their block or ask for. */
export const BLOCK_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// A local normaliser rather than importing leaguePreview's: this module has no
// imports at all, which is what lets the whole engine be tested without a
// browser, a network or a league.
const normalizeName = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Blocks keyed by roster id, from the three things the app can actually read:
 * the rosters, who claims which team (user_leagues), and what each manager
 * declared. Matching goes through the claimed team name, the same join the
 * rest of the app uses to work out whose team is whose.
 */
export const indexBlocksByRoster = (rosters, claims, blocks) => {
    const byUser = new Map();
    (blocks || []).forEach(b => { if (b?.user_id) byUser.set(String(b.user_id), b); });
    if (!byUser.size) return {};

    const rosterByName = new Map();
    Object.entries(rosters || {}).forEach(([rosterId, roster]) => {
        const key = normalizeName(roster?.team_name);
        // First claim wins: two rosters sharing a normalised name cannot be
        // told apart, and guessing would attach a manager's block to somebody
        // else's team.
        if (key && !rosterByName.has(key)) rosterByName.set(key, String(rosterId));
    });

    const out = {};
    (claims || []).forEach(claim => {
        const block = byUser.get(String(claim?.user_id));
        if (!block) return;
        const rosterId = rosterByName.get(normalizeName(claim?.team_name));
        if (rosterId) out[rosterId] = block;
    });
    return out;
};

/**
 * How well a proposal matches what the two managers have declared.
 *
 * A block match is a HANDSHAKE, with two legs:
 *
 *   outbound -- the player leaving your roster is one they said they need,
 *               and/or one you said you would move
 *   inbound  -- the player coming back is one they said they are shopping,
 *               and/or one you said you need
 *
 * Both legs have to connect. The first version scored the four signals
 * independently and added them up, which meant a trade could be boosted off
 * "they need RB" alone -- while nothing said you would part with a back, or
 * that you wanted anything coming the other way. That is not a trade anybody
 * asked for, it is half of one, and it was the reported problem: results that
 * did not look like they matched the blocks at all.
 *
 * Each leg scores 0.5 for one side declaring it and 1.0 when both sides
 * agree, so a full four-way handshake is a perfect fit and a thinner one
 * still counts. Either leg at zero is no match at all.
 *
 * Note what this still does NOT do: it never makes a trade valid. Only the
 * lineup maths decides that, so a declaration can reorder the list and can
 * never surface a deal that makes somebody's team worse.
 */
export const blockFit = (proposal, theirBlock, myBlock) => {
    const none = { fit: 0, reasons: [], legs: { outbound: 0, inbound: 0 } };
    if (!proposal || (!theirBlock && !myBlock)) return none;

    const givePos = new Set((proposal.give || []).map(p => p?.pos).filter(Boolean));
    const getPos = new Set((proposal.get || []).map(p => p?.pos).filter(Boolean));
    const getIds = new Set((proposal.get || []).map(p => String(p?.player_id ?? '')));

    const outReasons = [];
    const inReasons = [];
    let theyNeedIt = false, iWouldMoveIt = false;
    let theyWouldMoveIt = false, iNeedIt = false, namedByThem = false;

    // --- outbound: is the player leaving one anybody wanted to move? ---
    (theirBlock?.needs || []).forEach(pos => {
        if (givePos.has(pos)) { theyNeedIt = true; outReasons.push(`they need ${pos}`); }
    });
    (myBlock?.shopping || []).forEach(pos => {
        if (givePos.has(pos)) { iWouldMoveIt = true; outReasons.push(`you're shopping ${pos}`); }
    });

    // --- inbound: is the player coming back one anybody wanted here? ---
    (theirBlock?.shopping || []).forEach(pos => {
        if (getPos.has(pos)) { theyWouldMoveIt = true; inReasons.push(`they're shopping ${pos}`); }
    });
    (myBlock?.needs || []).forEach(pos => {
        if (getPos.has(pos)) { iNeedIt = true; inReasons.push(`you need ${pos}`); }
    });
    // A manager who named a player has already said out loud that he is
    // available, which settles the inbound leg on its own.
    (theirBlock?.players || []).forEach(id => {
        if (getIds.has(String(id))) { namedByThem = true; inReasons.push('on their block by name'); }
    });

    const outbound = (theyNeedIt ? 0.5 : 0) + (iWouldMoveIt ? 0.5 : 0);
    const inbound = namedByThem ? 1 : ((theyWouldMoveIt ? 0.5 : 0) + (iNeedIt ? 0.5 : 0));

    // Half a handshake is not a match. Reasons are dropped with it, so the
    // UI can never claim a trade "matches a block" while it scores nothing.
    if (!outbound || !inbound) return none;

    return {
        fit: Math.min(1, (outbound + inbound) / 2),
        reasons: [...new Set([...outReasons, ...inReasons])],
        legs: { outbound, inbound },
    };
};

export const playerLabel = (p) =>
    `${p?.fn || p?.first_name || ''} ${p?.ln || p?.last_name || ''}`.trim() || String(p?.player_id ?? 'Unknown');

/**
 * Ranked trades that improve both rosters.
 *
 * Ranked by the SMALLER of the two gains, not the total. A deal that hands me
 * twenty points and the other manager half a point scores well on total and
 * gets declined every time; ranking on the weaker side surfaces the ones with
 * a real reason for both managers to say yes.
 */
export const findTrades = ({
    me,
    opponents = [],
    slots,
    valueOf,
    maxGive = 2,
    maxGet = 2,
    poolSize = 10,
    minGain = 0.5,
    fairness = 0.35,
    limit = 20,
    // What each opponent has declared, keyed by roster id. Absent or empty,
    // every fit is 0 and the ranking is exactly what it was without it.
    blocks = {},
    myBlock = null,
    // A declared want is information about whether a trade gets ACCEPTED, not
    // about what it is worth -- a manager who publicly asked for a running
    // back is far likelier to say yes than one being cold-called. Ranking on
    // gain x likelihood is what justifies a multiplier at all, and 0.75 is
    // about the gap those two cases deserve. At 0.5 the boost was too small
    // to reorder anything: a matched +2.0 still lost to an unmatched +6.0,
    // so the list came back looking identical.
    blockWeight = 0.75,
    // Show only trades somebody has actually asked for. The surest way to
    // see what a block is doing is to be able to switch it on.
    matchingOnly = false,
} = {}) => {
    const excluded = [];
    const usable = (team) => {
        const ok = [];
        (team?.players || []).forEach(p => {
            if (Number.isFinite(valueOf(p))) ok.push(p);
            else excluded.push({ team: team?.teamName || null, player: playerLabel(p), pos: p?.pos || null });
        });
        // Only the most valuable handful of each roster is worth enumerating:
        // the rest are bench bodies no manager trades for, and including them
        // multiplies the search for nothing.
        return ok.sort((a, b) => valueOf(b) - valueOf(a)).slice(0, poolSize);
    };

    const myPool = usable(me);
    const myPackages = packages(myPool, maxGive);
    const proposals = [];
    let considered = 0;

    opponents.forEach(opp => {
        const theirPool = usable(opp);
        const theirPackages = packages(theirPool, maxGet);

        myPackages.forEach(give => {
            const giveValue = sumValue(give, valueOf);
            theirPackages.forEach(get => {
                considered++;
                const getValue = sumValue(get, valueOf);

                // Fairness first, because it is arithmetic on numbers already
                // in hand, and it throws out most of the search before the
                // expensive part. A lopsided package is declined on sight by a
                // real manager, so there is no point costing out its lineups.
                const gap = Math.abs(giveValue - getValue) / Math.max(giveValue, getValue, 1);
                if (gap > fairness) return;

                const gainMe = lineupGain({ players: me.players, give, get, slots, valueOf });
                if (gainMe < minGain) return;
                const gainThem = lineupGain({ players: opp.players, give: get, get: give, slots, valueOf });
                if (gainThem < minGain) return;

                const mutual = Math.round(Math.min(gainMe, gainThem) * 100) / 100;
                const { fit, reasons } = blockFit({ give, get }, blocks?.[String(opp.rosterId)], myBlock);
                if (matchingOnly && fit === 0) return;

                proposals.push({
                    opponent: opp.teamName || opp.rosterId,
                    rosterId: opp.rosterId,
                    give, get,
                    gainMe, gainThem,
                    fit,
                    fitReasons: reasons,
                    // A bounded multiplier, not an additive bonus: a declared
                    // want can lift a trade by at most blockWeight, so it can
                    // reorder the list without ever inventing value that the
                    // lineups do not actually support.
                    score: Math.round(mutual * (1 + blockWeight * fit) * 100) / 100,
                    giveValue: Math.round(giveValue * 100) / 100,
                    getValue: Math.round(getValue * 100) / 100,
                    fairnessGap: Math.round(gap * 1000) / 1000,
                    // What both managers are shown. Ranking on it keeps the
                    // list honest about who has a reason to accept.
                    mutual,
                });
            });
        });
    });

    proposals.sort((a, b) =>
        b.score - a.score
        || b.mutual - a.mutual
        || (b.gainMe + b.gainThem) - (a.gainMe + a.gainThem)
        || playerLabel(a.get[0]).localeCompare(playerLabel(b.get[0])));

    return { proposals: proposals.slice(0, limit), excluded, considered };
};
