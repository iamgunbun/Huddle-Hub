// The matchup preview shown beside each league in the sidebar switcher.
//
// WHY THIS EXISTS SEPARATELY FROM THE MATCHUPS PAGE
// -------------------------------------------------
// Matchups.jsx loads everything needed to draw a full box score: the whole
// player dictionary, every roster's player list, per-player projections and
// live stats. That is correct for ONE league being looked at. The sidebar
// asks the same question for EVERY league at once, and the full load does
// not multiply safely -- on Yahoo, a league's roster fetch costs one proxy
// call per team, so four 10-team leagues would be ~40 calls just to open a
// menu.
//
// A preview only needs four numbers and two names, so this takes the cheap
// path to exactly those:
//   - team names, records and which roster is mine come from the
//     `teamsOnly` roster fetch (one standings call per league, already
//     cached per season in leagueRosters.js)
//   - scores come from the league's scoreboard/matchups endpoint alone,
//     with no per-player breakdown
//
// There is deliberately NO win probability here. The app has a season-level
// Monte Carlo (seasonSimulation.js) but no in-game win model, and inventing
// a percentage from a score difference would be presenting a guess with the
// authority of a computed number. The bar shows the share of points scored
// so far, which is what the data actually supports.

import { isYahooLeagueId, isEspnLeagueId } from './platformIds.js';
import { sleeperLeagueFormat, formatLabel } from './leagueFormat.js';

/** "4-1" or "4-1-1" -- ties only shown when there are any. */
export const teamRecord = (roster) => {
    const s = roster?.settings || {};
    const w = Number(s.wins) || 0;
    const l = Number(s.losses) || 0;
    const t = Number(s.ties) || 0;
    return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
};

/**
 * The subtitle line: "10-Team PPR", "10-Team Keeper PPR".
 *
 * Scoring comes from Sleeper's rec (points per reception) setting: 1 is PPR,
 * 0.5 is Half PPR, 0 or absent is standard. Yahoo and ESPN leagues go
 * through the same normalised `settings` shape their adapters build.
 *
 * The format word is only included when the platform actually said what the
 * format is. Sleeper publishes it; Yahoo does not (see leagueFormat.js), so
 * a Yahoo league reads "10-Team PPR" rather than claiming "Redraft" on the
 * strength of a field this app invented.
 */
export const previewSubtitle = (league) => {
    const parts = [];

    const teams = Number(league?.total_rosters) || 0;
    if (teams > 0) parts.push(`${teams}-Team`);

    const platform = league?.platform;
    if (platform === 'sleeper' && league?.settings?.type !== undefined && league?.settings?.type !== null) {
        const fmt = sleeperLeagueFormat(league.settings.type);
        if (fmt !== 'redraft') parts.push(formatLabel(fmt));
    }

    const rec = Number(league?.settings?.rec);
    if (rec === 1) parts.push('PPR');
    else if (rec > 0 && rec < 1) parts.push('Half PPR');

    return parts.join(' ');
};

/**
 * Puts team names onto Sleeper rosters.
 *
 * Sleeper's /rosters response carries no team name at all -- names live on
 * the separate /users endpoint and are joined by roster.owner_id. Without
 * this, every Sleeper roster has an undefined team_name, so the name match
 * below can never succeed and no Sleeper league ever shows a preview (and a
 * forced match would render "Team 1" anyway).
 *
 * Reads `metadata.team_name || display_name`, which is exactly the field
 * AddLeague.jsx stores on the connection, so the two sides are compared on
 * the same value rather than two different notions of a team's name.
 */
export const attachSleeperTeamNames = (rosters, users) => {
    const nameByUserId = new Map();
    (users || []).forEach(u => {
        if (!u?.user_id) return;
        const name = u.metadata?.team_name || u.display_name || null;
        if (name) nameByUserId.set(String(u.user_id), name);
    });
    if (!nameByUserId.size) return rosters || {};

    const out = {};
    Object.entries(rosters || {}).forEach(([key, roster]) => {
        // The primary owner names the team. A co-owner is only consulted
        // when there is no primary owner on file (a roster handed over
        // mid-season leaves owner_id pointing at nobody), never in
        // preference to one -- that would put the wrong manager's name on a
        // team that does have an owner.
        const name = (roster?.owner_id ? nameByUserId.get(String(roster.owner_id)) : null)
            || coOwnerIds(roster).map(id => nameByUserId.get(id)).find(Boolean)
            || null;
        // A roster with no matching user at all keeps its original shape
        // rather than gaining an empty name.
        out[key] = name ? { ...roster, team_name: name } : roster;
    });
    return out;
};

/** A roster's co-owners as strings. Sleeper leaves the field null when there are none. */
const coOwnerIds = (roster) => (Array.isArray(roster?.co_owners) ? roster.co_owners : [])
    .filter(Boolean)
    .map(String);

/**
 * Normalised name -> Sleeper user id, indexing BOTH names a member can be
 * known by.
 *
 * AddLeague.jsx stores `metadata.team_name || display_name` on the
 * connection, so the stored name is whichever of the two was set at connect
 * time. Matching it back against only the field that currently wins loses
 * the league in two real cases: the manager has since set (or cleared) a
 * team name in Sleeper, and the roster is CO-OWNED, where the name on the
 * roster belongs to the primary owner and so can never equal the
 * co-owner's. Both end with no preview at all for that one league while
 * every other Sleeper league renders -- which is exactly how this was
 * reported.
 */
export const sleeperOwnerIdsByName = (users) => {
    const byName = new Map();
    (users || []).forEach(u => {
        if (!u?.user_id) return;
        [u.metadata?.team_name, u.display_name].forEach(candidate => {
            const key = normalizeName(candidate);
            // First writer wins: two members with the same display name is
            // not something this can resolve, and picking the later one
            // would be no more correct than picking the earlier.
            if (key && !byName.has(key)) byName.set(key, String(u.user_id));
        });
    });
    return byName;
};

/**
 * Which roster belongs to the signed-in manager.
 *
 * Yahoo and ESPN flag it directly on the roster, which is authoritative.
 * Sleeper has no such flag, so it falls back to matching the team name
 * stored on the connection -- the same approach Matchups.jsx and Rosters.jsx
 * already use. Returns null rather than guessing when neither resolves: a
 * preview for the wrong team is worse than no preview.
 */
export const pickMyRosterId = (rosters, connectionTeamName, ownerIdsByName = null) => {
    const list = Object.values(rosters || {});
    if (!list.length) return null;

    const flagged = list.find(r => r?.is_owned_by_current_login);
    if (flagged) return String(flagged.roster_id);

    const wanted = normalizeName(connectionTeamName);
    if (!wanted) return null;

    // The stored name identifies a PERSON, and a person owns a roster
    // outright or alongside someone else. Resolving to their user id first
    // covers the co-owned roster, whose team_name is the primary owner's.
    const myUserId = ownerIdsByName?.get(wanted) || null;
    if (myUserId) {
        const byOwner = list.find(r => String(r?.owner_id ?? '') === myUserId)
            || list.find(r => coOwnerIds(r).includes(myUserId));
        if (byOwner) return String(byOwner.roster_id);
    }

    const byName = list.find(r => normalizeName(r?.team_name) === wanted);
    return byName ? String(byName.roster_id) : null;
};

const normalizeName = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

/**
 * My row and my opponent's row out of a week's matchup list.
 *
 * Pairing is by matchup_id, which every platform adapter normalises to.
 * A bye week (nobody shares my matchup_id) returns an opponent of null --
 * a real state the caller renders rather than an error.
 */
export const findMatchupPair = (matchups, myRosterId) => {
    if (!Array.isArray(matchups) || !myRosterId) return { mine: null, opponent: null };

    const mine = matchups.find(m => String(m?.roster_id) === String(myRosterId)) || null;
    if (!mine) return { mine: null, opponent: null };

    const opponent = matchups.find(m =>
        String(m?.roster_id) !== String(myRosterId)
        && m?.matchup_id !== null
        && m?.matchup_id !== undefined
        && String(m.matchup_id) === String(mine.matchup_id)
    ) || null;

    return { mine, opponent };
};

/**
 * The left-hand share of the bar, 0-100.
 *
 * Both sides on zero (before kickoff) splits evenly rather than dividing by
 * zero or slamming the bar to one end, which would read as a blowout in a
 * game that has not started.
 */
export const scoreShare = (a, b) => {
    const x = Number(a) || 0;
    const y = Number(b) || 0;
    const total = x + y;
    if (total <= 0) return 50;
    return Math.round((x / total) * 1000) / 10;
};

/**
 * Assembles the display object from already-fetched pieces. Pure, so the
 * shaping can be tested without any network.
 */
export const buildPreview = ({ league, rosters, matchups, myRosterId }) => {
    const myRoster = rosters?.[myRosterId] || rosters?.[String(myRosterId)] || null;
    const { mine, opponent } = findMatchupPair(matchups, myRosterId);
    if (!myRoster || !mine) return null;

    const oppRoster = opponent
        ? (rosters?.[opponent.roster_id] || rosters?.[String(opponent.roster_id)] || null)
        : null;

    const myScore = round2(mine.points);
    const oppScore = opponent ? round2(opponent.points) : null;

    return {
        subtitle: previewSubtitle(league),
        me: {
            name: myRoster.team_name || `Team ${myRosterId}`,
            avatar: myRoster.avatar || '/fallback.png',
            record: teamRecord(myRoster),
            score: myScore,
            projected: numOrNull(mine.projected_points),
        },
        // Null on a bye week, which the sidebar renders as "Bye week".
        opponent: opponent ? {
            name: oppRoster?.team_name || `Team ${opponent.roster_id}`,
            avatar: oppRoster?.avatar || '/fallback.png',
            record: oppRoster ? teamRecord(oppRoster) : '',
            score: oppScore,
            projected: numOrNull(opponent.projected_points),
        } : null,
        share: opponent ? scoreShare(myScore, oppScore) : 100,
        leading: opponent ? myScore > oppScore : true,
    };
};

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : (Number(v) || 0));

// Previews are re-read every time the sidebar opens, which on a busy Sunday
// is often. A short TTL keeps a live score current without re-hitting three
// platforms for every menu toggle.
const PREVIEW_TTL_MS = 60000;
const cache = new Map();

export const clearPreviewCache = () => cache.clear();

/**
 * Fetches one league's preview. Resolves to null for anything it cannot
 * answer confidently -- an unconnected platform, a league whose team can't
 * be identified, a failed call. The sidebar renders those rows exactly as it
 * did before, so a preview failure costs the league switcher nothing.
 */
export const fetchLeaguePreview = async (league, week, { now = Date.now } = {}) => {
    const leagueId = league?.sleeper_league_id;
    if (!leagueId || !week) return null;

    const key = `${leagueId}:${week}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < PREVIEW_TTL_MS) return hit.value;

    try {
        const { getLeagueRosters } = await import('./helperFunctions/leagueRosters');
        const [{ rosters: rawRosters }, matchups, sleeperUsers] = await Promise.all([
            getLeagueRosters(leagueId, { teamsOnly: true }),
            fetchWeekMatchups(leagueId, week),
            fetchSleeperUsers(leagueId),
        ]);

        // Yahoo and ESPN already name their teams on the roster; Sleeper
        // needs its /users join first (see attachSleeperTeamNames).
        const rosters = sleeperUsers.length
            ? attachSleeperTeamNames(rawRosters, sleeperUsers)
            : rawRosters;

        const myRosterId = pickMyRosterId(
            rosters, league?.team_name, sleeperOwnerIdsByName(sleeperUsers)
        );
        const value = myRosterId
            ? buildPreview({ league, rosters, matchups, myRosterId })
            : null;

        // One league rendering no preview while the others do is the exact
        // shape this has been reported in twice, and from the outside the
        // three causes look identical. Named here so the next report says
        // which one it is instead of starting from scratch.
        if (!value) {
            console.warn(
                `[sidebar] no preview for league ${leagueId}: `
                + `${Object.keys(rosters || {}).length} roster(s), `
                + `${Array.isArray(matchups) ? matchups.length : 0} matchup row(s) for week ${week}, `
                + `${myRosterId ? `my roster is ${myRosterId}` : `could not identify "${league?.team_name ?? ''}"`}`
            );
        }

        cache.set(key, { at: now(), value });
        return value;
    } catch (err) {
        console.warn(`[sidebar] preview unavailable for league ${leagueId}:`, err?.message || err);
        // Cached as a miss so one failing league doesn't get retried on every
        // single menu open while the others render fine.
        cache.set(key, { at: now(), value: null });
        return null;
    }
};

/**
 * Team totals for a week, and nothing else.
 *
 * Note this does NOT use fetchAndNormalizeYahooMatchups: that helper also
 * pulls every team's per-player points, which is the expensive walk the
 * module comment above exists to avoid. The scoreboard alone already carries
 * the team totals a preview needs.
 */
const fetchWeekMatchups = async (leagueId, week) => {
    if (isYahooLeagueId(leagueId)) {
        const { fetchYahooScoreboardTotals } = await import('./yahooService');
        return fetchYahooScoreboardTotals(leagueId, week);
    }

    if (isEspnLeagueId(leagueId)) {
        const { fetchAndNormalizeESPNMatchups } = await import('./espnService');
        const { matchups } = await fetchAndNormalizeESPNMatchups(leagueId, week);
        return flattenMatchupMap(matchups);
    }

    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
    if (!res.ok) throw new Error(`Sleeper matchups ${res.status}`);
    return res.json();
};

/**
 * Sleeper's league members, for the team-name join above. Empty for every
 * other platform, whose adapters already put the name on the roster.
 *
 * Unauthenticated and cheap -- one call alongside the two this already
 * makes -- and a failure returns empty rather than throwing, which costs
 * the league its preview but never the whole sidebar.
 */
const fetchSleeperUsers = async (leagueId) => {
    if (isYahooLeagueId(leagueId) || isEspnLeagueId(leagueId)) return [];
    try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
        if (!res.ok) return [];
        const users = await res.json();
        return Array.isArray(users) ? users : [];
    } catch {
        return [];
    }
};

/** The adapters return { matchupId: [teamA, teamB] }; this is the flat list. */
export const flattenMatchupMap = (matchups) => {
    const flat = [];
    Object.entries(matchups || {}).forEach(([mId, pair]) => {
        (pair || []).forEach(team => flat.push({ ...team, matchup_id: mId }));
    });
    return flat;
};
