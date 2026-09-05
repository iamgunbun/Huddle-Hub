// Playoff and championship odds, by simulating the rest of the season.
//
// The odds this replaces were a softmax over a power score with hand-picked
// constants, then clamped -- which produces numbers that look like percentages
// but aren't. They didn't sum to anything, a team's playoff odds didn't depend
// on who it still had to play, and the championship number was a re-scaled
// version of the same curve rather than a separate question.
//
// What actually answers it: play the remaining schedule many times and count.
// Every team gets a weekly scoring distribution, each remaining game is drawn
// from it, the standings are sorted the way the league sorts them, and the
// playoff bracket is played out. The share of runs a team makes the playoffs IS
// its playoff probability -- no tuning constant, and it responds to wins,
// losses, points and strength of schedule because all four are in the model.
//
// Dependency-free on purpose: the maths is the part worth testing, and it can't
// be checked against a live league.

// --- Randomness -------------------------------------------------------------
// Seeded so a league's odds don't jitter between renders, and so tests can
// assert on exact numbers. mulberry32: small, fast, good enough for this.
export const makeRng = (seed) => {
    let a = (seed >>> 0) || 1;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** A stable seed for a league-week, so the same inputs give the same odds. */
export const seedFrom = (...parts) => {
    let hash = 2166136261;
    for (const part of parts.join('|')) {
        hash ^= part.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

// Box-Muller. Scores are truncated at zero because a fantasy team cannot score
// negative points, and the tail would otherwise drag the mean down.
const drawScore = (rng, mean, stdDev) => {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, mean + z * stdDev);
};

// --- Schedule ---------------------------------------------------------------

/**
 * Turns one week's matchup rows into the games they represent.
 *
 * Both platforms describe a week as a flat list of team entries sharing a
 * matchup id rather than as pairs, so the pairing has to be reconstructed. A
 * group that isn't exactly two teams is dropped: an odd group means a bye or a
 * malformed week, and inventing an opponent would put a fictional game into
 * every simulated season.
 */
export const pairMatchupRows = (rows, week) => {
    const byMatchup = new Map();

    (rows || []).forEach(row => {
        const rosterId = row?.roster_id;
        const matchupId = row?.matchup_id;
        if (rosterId === undefined || rosterId === null || matchupId === undefined || matchupId === null) return;
        const key = String(matchupId);
        if (!byMatchup.has(key)) byMatchup.set(key, []);
        byMatchup.get(key).push(rosterId);
    });

    const games = [];
    byMatchup.forEach(sides => {
        if (sides.length !== 2) return;
        games.push({ week, home: sides[0], away: sides[1] });
    });
    return games;
};

// --- The team model ---------------------------------------------------------

/**
 * A team's expected weekly score.
 *
 * Before anyone has played, the roster is all we know. After a full season, the
 * results are. In between, blending on games played is right -- but the old
 * code ramped linearly to a fixed 14 weeks, which trusts a 1-0 team's single
 * result at 7% and a 13-0 team's at 93% regardless of how noisy fantasy weeks
 * are. Shrinkage toward the roster prior is the standard answer: the prior is
 * worth `priorGames` games, and the observed average earns weight as real games
 * accumulate. Four games is the usual choice for weekly fantasy scoring, where
 * a single week's variance is enormous.
 */
export const blendedScoringMean = ({ pointsFor = 0, weeksPlayed = 0, rosterStrength = 0, priorGames = 4 }) => {
    const played = Math.max(0, weeksPlayed);
    if (!played) return rosterStrength;

    const actualPerWeek = pointsFor / played;
    // A roster with no usable projections tells us nothing; don't shrink toward zero.
    if (!rosterStrength) return actualPerWeek;

    return ((actualPerWeek * played) + (rosterStrength * priorGames)) / (played + priorGames);
};

// Week-to-week spread. Fantasy weekly scores sit around a quarter of the mean
// in standard deviation; used only when a league's own history isn't available.
export const DEFAULT_SCORE_VOLATILITY = 0.26;

// --- Standings --------------------------------------------------------------

/**
 * Orders teams the way both platforms do: wins first, then points for. Ties in
 * the record are broken by points, which is what makes a high-scoring team with
 * a bad record still worth something in the simulation.
 */
export const sortBySeed = (teams) => [...teams].sort((a, b) =>
    (b.wins + b.ties * 0.5) - (a.wins + a.ties * 0.5) || b.pointsFor - a.pointsFor
);

/**
 * Plays a seeded single-elimination bracket and returns the winner's roster id.
 *
 * Seeds beyond the nearest power of two get a first-round bye, which is how both
 * platforms run a 4- or 6-team playoff. Higher seeds are paired against lower
 * ones each round.
 */
const playBracket = (seeds, rng, teamsById) => {
    if (!seeds.length) return null;

    let field = [...seeds];
    // Byes: the top teams sit out until the field is a power of two.
    const targetSize = 2 ** Math.floor(Math.log2(field.length));
    if (field.length > targetSize) {
        const playInCount = (field.length - targetSize) * 2;
        const byes = field.slice(0, field.length - playInCount);
        const playIn = field.slice(field.length - playInCount);

        const advanced = [];
        for (let i = 0; i < playIn.length / 2; i++) {
            const high = playIn[i];
            const low = playIn[playIn.length - 1 - i];
            advanced.push(playGame(high, low, rng, teamsById));
        }
        field = [...byes, ...advanced];
    }

    while (field.length > 1) {
        const next = [];
        for (let i = 0; i < field.length / 2; i++) {
            next.push(playGame(field[i], field[field.length - 1 - i], rng, teamsById));
        }
        field = next;
    }
    return field[0];
};

const playGame = (aId, bId, rng, teamsById) => {
    const a = teamsById.get(aId);
    const b = teamsById.get(bId);
    const scoreA = drawScore(rng, a.mean, a.stdDev);
    const scoreB = drawScore(rng, b.mean, b.stdDev);
    // A dead-heat goes to the better seed, which is the order they arrived in.
    return scoreA >= scoreB ? aId : bId;
};

// --- The simulation ---------------------------------------------------------

/**
 * @param {object[]} teams  { rosterId, wins, losses, ties, pointsFor, mean, stdDev }
 * @param {object[]} schedule  remaining games: { week, home, away }
 * @param {number} playoffSpots
 * @param {number} iterations
 * @param {function} rng
 */
export const simulateSeason = ({ teams, schedule = [], playoffSpots = 6, iterations = 2000, rng = Math.random }) => {
    const roster = (teams || []).filter(t => t && t.rosterId !== undefined && t.rosterId !== null);
    if (!roster.length) return [];

    const spots = Math.max(1, Math.min(playoffSpots, roster.length));
    const teamsById = new Map(roster.map(t => [t.rosterId, {
        mean: Number(t.mean) || 0,
        stdDev: Math.max(1, Number(t.stdDev) || (Number(t.mean) || 0) * DEFAULT_SCORE_VOLATILITY),
    }]));

    const tally = new Map(roster.map(t => [t.rosterId, { playoffs: 0, titles: 0, wins: 0, pointsFor: 0 }]));

    for (let run = 0; run < iterations; run++) {
        const season = new Map(roster.map(t => [t.rosterId, {
            rosterId: t.rosterId,
            wins: Number(t.wins) || 0,
            losses: Number(t.losses) || 0,
            ties: Number(t.ties) || 0,
            pointsFor: Number(t.pointsFor) || 0,
        }]));

        for (const game of schedule) {
            const home = season.get(game.home);
            const away = season.get(game.away);
            if (!home || !away) continue;

            const homeScore = drawScore(rng, teamsById.get(game.home).mean, teamsById.get(game.home).stdDev);
            const awayScore = drawScore(rng, teamsById.get(game.away).mean, teamsById.get(game.away).stdDev);

            home.pointsFor += homeScore;
            away.pointsFor += awayScore;

            if (homeScore > awayScore) { home.wins++; away.losses++; }
            else if (awayScore > homeScore) { away.wins++; home.losses++; }
            else { home.ties++; away.ties++; }
        }

        const ordered = sortBySeed([...season.values()]);
        const qualifiers = ordered.slice(0, spots);

        qualifiers.forEach(t => { tally.get(t.rosterId).playoffs++; });

        const champion = playBracket(qualifiers.map(t => t.rosterId), rng, teamsById);
        if (champion !== null && tally.has(champion)) tally.get(champion).titles++;

        season.forEach((t, id) => {
            const acc = tally.get(id);
            acc.wins += t.wins;
            acc.pointsFor += t.pointsFor;
        });
    }

    return roster.map(t => {
        const acc = tally.get(t.rosterId);
        return {
            rosterId: t.rosterId,
            playoffOdds: acc.playoffs / iterations,
            titleOdds: acc.titles / iterations,
            projectedWins: acc.wins / iterations,
            projectedPointsFor: acc.pointsFor / iterations,
        };
    });
};

/**
 * Turns fractions into whole percentages that still add up.
 *
 * Rounding each odds figure on its own is what lets a set of playoff
 * probabilities total 97% or 104%. Largest-remainder keeps the total exact, so
 * the column reads as a real distribution.
 */
export const toWholePercentages = (values, total) => {
    const scaled = values.map((v, i) => ({ i, exact: v * 100, floor: Math.floor(v * 100) }));
    const target = Math.round(total * 100);
    let remaining = target - scaled.reduce((sum, s) => sum + s.floor, 0);

    const byRemainder = [...scaled].sort((a, b) =>
        (b.exact - b.floor) - (a.exact - a.floor) || a.i - b.i
    );
    const result = new Array(values.length);
    scaled.forEach(s => { result[s.i] = s.floor; });

    for (const s of byRemainder) {
        if (remaining <= 0) break;
        result[s.i] += 1;
        remaining--;
    }
    return result;
};
