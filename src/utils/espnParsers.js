// Pure ESPN Fantasy API parsing/normalization -- no fetches, no store access, so
// this stays directly testable the same way yahooHistory.js's parsers are.
//
// ESPN's API is unofficial and undocumented by ESPN itself; the shapes read here
// (schedule[], teams[].roster.entries[], transactions[], draftDetail.picks[])
// match the field names the community-maintained clients (e.g. cwendt94/espn-api)
// have reverse-engineered. Every reader below is defensive (Array.isArray guards,
// optional chaining, numeric fallbacks) so an unexpected shape degrades to an
// empty/null result instead of throwing.

// ESPN identifies NFL teams by a small numeric id, not an abbreviation. This
// table is the same one used by every third-party ESPN Fantasy client.
export const ESPN_PRO_TEAM_MAP = {
    0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
    8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
    16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
    24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

export const espnProTeamAbbr = (proTeamId) => ESPN_PRO_TEAM_MAP[proTeamId] || 'FA';

// ESPN's own `statId` -> the stat key Sleeper's projections/stats feeds use
// (the same target keys Yahoo's own scoring translation, buildYahooScoringSettings
// in yahooScoring.js, produces). Unlike Yahoo, ESPN's scoring settings carry no
// human-readable stat name at all -- only this numeric id -- so there's no way
// to resolve it dynamically the way Yahoo's stat_categories allows; it has to
// be a hardcoded table. Sourced from cwendt94/espn-api's PLAYER_STATS_MAP (the
// community-maintained reference every third-party ESPN Fantasy client is
// built against), not guessed from memory.
const ESPN_STAT_MAP = {
    // Offense -- a straight per-unit/per-event copy, same as Yahoo's.
    3: 'pass_yd', 4: 'pass_td', 19: 'pass_2pt', 20: 'pass_int',
    24: 'rush_yd', 25: 'rush_td', 26: 'rush_2pt',
    42: 'rec_yd', 43: 'rec_td', 44: 'rec_2pt', 53: 'rec',
    72: 'fum_lost',
    // Extra points -- these map 1:1, unlike field goals (see below).
    86: 'xpm', 88: 'xpmiss',
    // Defense -- these six also map 1:1; only the points-allowed tiers and
    // field-goal distances (below) need special handling.
    99: 'sack', 95: 'int', 96: 'fum_rec', 94: 'def_td', 98: 'safe', 97: 'blk_kick',
};

// ESPN splits made/missed field goals into three distance bands; Sleeper's
// own feed (and scoreStatLine's FG_BUCKET_KEYS) expects five narrower ones.
// Rather than leave a whole position's scoring unmapped over a granularity
// mismatch, the one ESPN band covering 0-39 yards is copied into all three of
// Sleeper's sub-40 buckets -- scoreStatLine only ever uses these as fallback
// averages when a stat line lacks its own per-distance breakdown, so a flat
// value across that range is a reasonable stand-in, not a source of error.
const ESPN_FG_MADE_UNDER_40 = 80, ESPN_FG_MADE_40_49 = 77, ESPN_FG_MADE_50P = 74;
const ESPN_FG_MISS_UNDER_40 = 82, ESPN_FG_MISS_40_49 = 79, ESPN_FG_MISS_50P = 76;

// ESPN scores points-allowed in nine tiers; Sleeper's scoreStatLine only
// recognizes seven, split at different boundaries (14-20/21-27 vs ESPN's
// 14-17/18-21/22-27). Where a boundary doesn't land evenly, the Sleeper
// bucket takes the ESPN tier with the larger overlap (14-17 for 14-20, 22-27
// for 21-27) or an average of the two ESPN tiers spanning it (35-45 and 45+
// for Sleeper's single 35+). This is an approximation of the league's real
// curve, not a source id ambiguity -- the two schemes' tier boundaries simply
// don't coincide.
const ESPN_PTS_ALLOW = {
    0: 89, oneToSix: 90, sevenToThirteen: 91,
    fourteenToSeventeen: 92, eighteenToTwentyOne: 121,
    twentyTwoToTwentySeven: 122, twentyEightToThirtyFour: 123,
    thirtyFiveToFortyFive: 124, fortyFivePlus: 125,
};

/**
 * Builds a Sleeper-shaped scoring_settings object from an ESPN league's
 * `settings.scoringSettings.scoringItems` -- the same target shape
 * buildYahooScoringSettings (yahooScoring.js) produces from Yahoo's
 * equivalent, so scoreStatLine (also in yahooScoring.js) can score a
 * projection against either platform's rules identically.
 *
 * `isReverseItem` marks a category as a penalty (interceptions, fumbles)
 * regardless of which sign ESPN happened to store the raw value with.
 */
export const buildEspnScoringSettings = (scoringSettingsRaw) => {
    const items = Array.isArray(scoringSettingsRaw?.scoringItems) ? scoringSettingsRaw.scoringItems : [];
    const byStatId = {};
    const scoring = {};

    items.forEach(item => {
        const statId = item?.statId;
        const raw = parseFloat(item?.points);
        if (statId === undefined || Number.isNaN(raw)) return;
        const signed = item.isReverseItem ? -Math.abs(raw) : raw;
        byStatId[statId] = signed;

        const key = ESPN_STAT_MAP[statId];
        if (key) scoring[key] = signed;
    });

    const under40 = byStatId[ESPN_FG_MADE_UNDER_40];
    if (under40 !== undefined) scoring.fgm_0_19 = scoring.fgm_20_29 = scoring.fgm_30_39 = under40;
    if (byStatId[ESPN_FG_MADE_40_49] !== undefined) scoring.fgm_40_49 = byStatId[ESPN_FG_MADE_40_49];
    if (byStatId[ESPN_FG_MADE_50P] !== undefined) scoring.fgm_50p = byStatId[ESPN_FG_MADE_50P];

    const missUnder40 = byStatId[ESPN_FG_MISS_UNDER_40];
    if (missUnder40 !== undefined) scoring.fgmiss_0_19 = scoring.fgmiss_20_29 = scoring.fgmiss_30_39 = missUnder40;
    if (byStatId[ESPN_FG_MISS_40_49] !== undefined) scoring.fgmiss_40_49 = byStatId[ESPN_FG_MISS_40_49];
    if (byStatId[ESPN_FG_MISS_50P] !== undefined) scoring.fgmiss_50p = byStatId[ESPN_FG_MISS_50P];

    if (byStatId[ESPN_PTS_ALLOW[0]] !== undefined) scoring.pts_allow_0 = byStatId[ESPN_PTS_ALLOW[0]];
    if (byStatId[ESPN_PTS_ALLOW.oneToSix] !== undefined) scoring.pts_allow_1_6 = byStatId[ESPN_PTS_ALLOW.oneToSix];
    if (byStatId[ESPN_PTS_ALLOW.sevenToThirteen] !== undefined) scoring.pts_allow_7_13 = byStatId[ESPN_PTS_ALLOW.sevenToThirteen];
    if (byStatId[ESPN_PTS_ALLOW.fourteenToSeventeen] !== undefined) scoring.pts_allow_14_20 = byStatId[ESPN_PTS_ALLOW.fourteenToSeventeen];
    if (byStatId[ESPN_PTS_ALLOW.twentyTwoToTwentySeven] !== undefined) scoring.pts_allow_21_27 = byStatId[ESPN_PTS_ALLOW.twentyTwoToTwentySeven];
    if (byStatId[ESPN_PTS_ALLOW.twentyEightToThirtyFour] !== undefined) scoring.pts_allow_28_34 = byStatId[ESPN_PTS_ALLOW.twentyEightToThirtyFour];

    const thirtyFiveToFortyFive = byStatId[ESPN_PTS_ALLOW.thirtyFiveToFortyFive];
    const fortyFivePlus = byStatId[ESPN_PTS_ALLOW.fortyFivePlus];
    if (thirtyFiveToFortyFive !== undefined && fortyFivePlus !== undefined) {
        scoring.pts_allow_35p = (thirtyFiveToFortyFive + fortyFivePlus) / 2;
    } else if (thirtyFiveToFortyFive !== undefined) {
        scoring.pts_allow_35p = thirtyFiveToFortyFive;
    } else if (fortyFivePlus !== undefined) {
        scoring.pts_allow_35p = fortyFivePlus;
    }

    return scoring;
};

/**
 * The season immediately before `seasonId`, out of ESPN's own list of every
 * year this league has existed (`status.previousSeasons`). Null when there
 * isn't one -- either the list is empty/missing, or every entry in it is the
 * current season or later (a malformed or out-of-order list shouldn't walk a
 * history walk backwards into the future).
 *
 * ESPN keeps one league id for its whole lifetime -- a past season is a
 * different `year` query against that SAME id, not a different id the way
 * Sleeper/Yahoo mint one each season -- so this is what stands in for
 * Sleeper/Yahoo's own `previous_league_id` field once wrapped by
 * toEspnSeasonLeagueId (platformIds.js).
 */
export const findPriorEspnSeason = (previousSeasons, seasonId) => {
    const year = parseInt(seasonId);
    if (!Number.isFinite(year)) return null;

    const prior = (Array.isArray(previousSeasons) ? previousSeasons : [])
        .map(y => parseInt(y))
        .filter(y => Number.isFinite(y) && y < year)
        .sort((a, b) => b - a)[0];

    return Number.isFinite(prior) ? prior : null;
};

/**
 * Whether a season's regular-season-plus-playoffs schedule has fully played
 * out -- any season before the real current year always has, and the live
 * one has once its last scoring period has come and gone. Records/Awards
 * read this the same way they already do for Yahoo's `status === 'complete'`,
 * to decide whether a season's final standing counts as a podium yet (crowning
 * a champion off October's standings would be wrong).
 */
export const isEspnSeasonComplete = ({ seasonId, currentMatchupPeriod, matchupPeriodCount, currentYear = new Date().getFullYear() }) => {
    const year = parseInt(seasonId);
    if (Number.isFinite(year) && year < currentYear) return true;

    const total = parseInt(matchupPeriodCount) || 0;
    if (!total) return false;
    return (parseInt(currentMatchupPeriod) || 0) > total;
};

// A player's `defaultPositionId` -- offense/kicker/defense only; ESPN's IDP ids
// (9-15) are left unmapped since standard leagues don't roster them.
export const ESPN_POSITION_MAP = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

export const espnPositionName = (defaultPositionId) => ESPN_POSITION_MAP[defaultPositionId] || 'BN';

// A roster entry's `lineupSlotId`. 20 is the bench, 21 is IR -- everything else
// (including FLEX/OP/superflex slot ids, which vary by league) is a starter.
const BENCH_SLOT = 20;
const IR_SLOT = 21;
export const isEspnStarterSlot = (lineupSlotId) => lineupSlotId !== BENCH_SLOT && lineupSlotId !== IR_SLOT;
export const isEspnReserveSlot = (lineupSlotId) => lineupSlotId === IR_SLOT;

// A starting lineup slot's label, in the same vocabulary Sleeper/Yahoo's own
// roster_positions already use (the Rosters page's flex-label rewrite --
// "WRRB_FLEX"/"SUPER_FLEX" -> "FLEX"/"S/FLEX" -- already handles both of
// these). IDP slots (8-15) fold into the three defensive buckets the Rosters
// page's own position-badge styling already recognises (DL/LB/DB), since it
// has no per-position color for each individual IDP slot.
export const ESPN_LINEUP_SLOT_MAP = {
    0: 'QB', 2: 'RB', 3: 'FLEX', 4: 'WR', 5: 'FLEX', 6: 'TE', 7: 'SUPER_FLEX',
    8: 'DL', 9: 'DL', 10: 'LB', 11: 'DL', 12: 'DB', 13: 'DB',
    16: 'DEF', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX',
};

export const espnLineupSlotName = (lineupSlotId) => ESPN_LINEUP_SLOT_MAP[lineupSlotId] || 'BN';

// The order starting-lineup slots are grouped in wherever their exact order
// matters: the league's own roster_positions list, and a roster's starters
// array, which is walked in lockstep with it (index i's player is assumed to
// occupy roster_positions[i]'s slot -- see Rosters.jsx). Both need the SAME
// grouping to line up; this is that one shared order.
const ESPN_SLOT_ORDER = [0, 2, 4, 6, 23, 3, 5, 7, 16, 17, 10, 9, 8, 11, 12, 13];
const espnSlotPriority = (lineupSlotId) => {
    const idx = ESPN_SLOT_ORDER.indexOf(lineupSlotId);
    return idx === -1 ? ESPN_SLOT_ORDER.length : idx;
};

/**
 * A league's starting lineup, flattened the way Sleeper/Yahoo's own
 * roster_positions already is (DEFAULT_POSITIONS in yahooService.js): each
 * starting slot's label, one entry per copy of it, followed by the bench
 * slots. Built from `settings.rosterSettings.lineupSlotCounts` -- a map of
 * lineupSlotId -> how many of that slot the league's lineup carries.
 *
 * Without this, the Rosters page's `rosterPositions[idx] || 'BN'` lookup
 * always misses for an ESPN league (there's nothing here to look up), which
 * is what showed every starter labeled "BN" instead of their real position.
 */
export const buildEspnRosterPositions = (lineupSlotCounts) => {
    const counts = lineupSlotCounts && typeof lineupSlotCounts === 'object' ? lineupSlotCounts : {};

    const starterSlots = [];
    const benchSlots = [];

    Object.entries(counts).forEach(([slotIdStr, count]) => {
        const slotId = parseInt(slotIdStr);
        const n = parseInt(count) || 0;
        if (!n || slotId === IR_SLOT) return;

        const label = espnLineupSlotName(slotId);
        const target = slotId === BENCH_SLOT ? benchSlots : starterSlots;
        for (let i = 0; i < n; i++) target.push({ slotId, label });
    });

    starterSlots.sort((a, b) => espnSlotPriority(a.slotId) - espnSlotPriority(b.slotId));

    return [...starterSlots, ...benchSlots].map(s => s.label);
};

// ESPN's headshot CDN follows a fixed pattern keyed by its own player id -- no
// lookup needed, unlike Yahoo which only gives a photo URL per-player in its
// own roster/player responses.
export const espnHeadshotUrl = (espnPlayerId) =>
    espnPlayerId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnPlayerId}.png` : null;

export const espnTeamDisplayName = (team) =>
    team?.name || [team?.location, team?.nickname].filter(Boolean).join(' ').trim() || `Team ${team?.id ?? ''}`.trim();

/**
 * One player, out of ESPN's public (no cookies needed) athlete-lookup
 * response -- the last-resort fallback for a transaction naming a player who
 * isn't on any current roster (fetchESPNTransactions' own roster-meta
 * fallback only ever covers currently-rostered players) and whom Sleeper's
 * espn_id crosswalk also doesn't cover. Same target metadata shape as
 * parseEspnRosterEntry, so it drops into the same yahooPlayersMeta-style
 * dictionary this app already knows how to fall back to for a crosswalk miss.
 */
export const parseEspnAthleteResponse = (data) => {
    const athlete = data?.athlete;
    if (!athlete?.id) return null;

    const fullName = athlete.displayName || athlete.fullName || '';
    const [firstName, ...lastParts] = fullName.split(' ');
    const id = String(athlete.id);

    return {
        id,
        fn: athlete.firstName || firstName || fullName,
        ln: athlete.lastName || lastParts.join(' '),
        pos: athlete.position?.abbreviation || 'BN',
        t: athlete.team?.abbreviation?.toUpperCase() || 'FA',
        headshot: athlete.headshot?.href || espnHeadshotUrl(id),
        injStatus: null,
        wi: {},
    };
};

// A team that hasn't uploaded a custom logo doesn't always get a usable
// absolute URL back in `logo` -- sometimes it's empty, sometimes ESPN's own
// default-logo placeholder comes back protocol-relative ("//g.espncdn.com/...")
// rather than "https://...", which an <img> tag can still resolve but which
// this app's other logo fields never otherwise carry. Normalized here so
// every consumer gets either a real absolute URL or nothing (and falls back
// to the app's own default), rather than something in between that renders
// as a broken image with no visible fallback.
export const espnTeamLogoUrl = (rawLogo) => {
    const logo = String(rawLogo || '').trim();
    if (!logo) return null;
    if (logo.startsWith('//')) return `https:${logo}`;
    if (/^https?:\/\//i.test(logo)) return logo;
    return null;
};

/**
 * One roster slot's player, in the shared player-dictionary metadata shape
 * (fn/ln/pos/t/headshot/injStatus/wi) the app already uses for a Yahoo league's
 * own player details (yahooPlayersMeta) -- reused verbatim so every page that
 * already knows how to fall back to that platform metadata for a
 * crosswalk-missed player works for ESPN too, without its own special case.
 *
 * `week`, when given, also looks for that scoring period's actual and
 * projected points (ESPN embeds these as pre-computed fantasy points --
 * `appliedTotal` -- already scored under the league's own rules, so there is no
 * scoring-settings translation to get wrong the way Sleeper's generic
 * projections need for Yahoo).
 */
export const parseEspnRosterEntry = (entry, week = null) => {
    const player = entry?.playerPoolEntry?.player;
    if (!player) return null;

    const id = String(entry.playerId ?? player.id ?? '');
    if (!id) return null;

    const fullName = player.fullName || `${player.firstName || ''} ${player.lastName || ''}`.trim();
    const [firstName, ...lastParts] = fullName.split(' ');

    const stats = Array.isArray(player.stats) ? player.stats : [];
    let actualPoints = null;
    let projectedPoints = null;
    if (Number.isFinite(week)) {
        const actual = stats.find(s => s?.scoringPeriodId === week && s?.statSourceId === 0);
        const projected = stats.find(s => s?.scoringPeriodId === week && s?.statSourceId === 1);
        if (actual && Number.isFinite(actual.appliedTotal)) actualPoints = actual.appliedTotal;
        if (projected && Number.isFinite(projected.appliedTotal)) projectedPoints = projected.appliedTotal;
    }

    return {
        id,
        fn: player.firstName || firstName || fullName,
        ln: player.lastName || lastParts.join(' '),
        pos: espnPositionName(player.defaultPositionId),
        t: espnProTeamAbbr(player.proTeamId),
        headshot: espnHeadshotUrl(id),
        injStatus: player.injuryStatus && player.injuryStatus !== 'ACTIVE' ? player.injuryStatus : null,
        isStarter: isEspnStarterSlot(entry.lineupSlotId),
        isReserve: isEspnReserveSlot(entry.lineupSlotId),
        actualPoints,
        projectedPoints,
        wi: {},
    };
};

/**
 * One ESPN team, in the roster shape the rest of the app already consumes for
 * Sleeper/Yahoo (see standingsRowToRoster in yahooService.js): roster_id,
 * owner_id, players[]/starters[]/reserve[] as string ids, settings.wins/losses.
 *
 * `resolvedSwid` marks which roster belongs to the connecting account -- ESPN's
 * own equivalent of Yahoo's `is_owned_by_current_login` flag -- so "my team"
 * can be found the same reliable way instead of falling back to a stored team
 * name string.
 */
export const parseEspnTeamRoster = (team, { week = null, resolvedSwid = null } = {}) => {
    const entries = Array.isArray(team?.roster?.entries) ? team.roster.entries : [];
    const players = [];
    // Collected with each starter's slot id so they can be sorted into the
    // same order buildEspnRosterPositions lays the league's roster_positions
    // out in -- the Rosters page walks both arrays in lockstep by index
    // (index i's player is assumed to occupy roster_positions[i]'s slot), so
    // whatever order ESPN happened to list this team's entries in isn't good
    // enough on its own.
    const starterEntries = [];
    const reserve = [];
    const playersMeta = {};

    entries.forEach(entry => {
        const parsed = parseEspnRosterEntry(entry, week);
        if (!parsed) return;
        players.push(parsed.id);
        if (parsed.isReserve) reserve.push(parsed.id);
        else if (parsed.isStarter) starterEntries.push({ id: parsed.id, lineupSlotId: entry.lineupSlotId });
        playersMeta[parsed.id] = parsed;
    });

    starterEntries.sort((a, b) => espnSlotPriority(a.lineupSlotId) - espnSlotPriority(b.lineupSlotId));
    const starters = starterEntries.map(s => s.id);

    const owners = Array.isArray(team?.owners) ? team.owners : [];
    const record = team?.record?.overall || {};
    const isOwnedByCurrentLogin = !!resolvedSwid && owners.some(
        o => String(o).toUpperCase() === String(resolvedSwid).toUpperCase()
    );

    const roster = {
        roster_id: team?.id,
        owner_id: owners[0] || `team-${team?.id}`,
        co_owners: owners.slice(1),
        team_name: espnTeamDisplayName(team),
        avatar: espnTeamLogoUrl(team?.logo) || '/brand.png',
        manager_name: espnTeamDisplayName(team),
        players,
        starters,
        reserve,
        is_owned_by_current_login: isOwnedByCurrentLogin,
        rank: team?.playoffSeed ?? null,
        playoff_seed: team?.playoffSeed ?? null,
        settings: {
            wins: record.wins || 0,
            losses: record.losses || 0,
            ties: record.ties || 0,
            fpts: Math.floor(record.pointsFor || 0),
            fpts_decimal: Math.round(((record.pointsFor || 0) % 1) * 100),
            fpts_against: Math.floor(record.pointsAgainst || 0),
            fpts_against_decimal: Math.round(((record.pointsAgainst || 0) % 1) * 100),
            division: team?.divisionId ?? 1,
        },
        metadata: {},
    };

    return { roster, playersMeta };
};

/** Every team's roster, plus a merged platform player-metadata fallback. */
export const parseEspnLeagueRosters = (espnData, { week = null, resolvedSwid = null } = {}) => {
    const teams = Array.isArray(espnData?.teams) ? espnData.teams : [];
    const rosters = {};
    const startersAndReserve = [];
    const espnPlayersMeta = {};

    teams.forEach(team => {
        const { roster, playersMeta } = parseEspnTeamRoster(team, { week, resolvedSwid });
        if (roster.roster_id === undefined || roster.roster_id === null) return;
        rosters[roster.roster_id] = roster;
        startersAndReserve.push(...roster.starters, ...roster.reserve);
        Object.assign(espnPlayersMeta, playersMeta);
    });

    return { rosters, startersAndReserve, yahooPlayersMeta: espnPlayersMeta };
};

/**
 * One matchup period's team pairings, in the shape the matchup pages already
 * consume for Yahoo (fetchAndNormalizeYahooMatchups): an object keyed by a
 * synthetic matchup index, each holding both teams' roster_id/points.
 *
 * ESPN's `schedule` covers every week of the season in one response, so unlike
 * Yahoo (one proxy call per week) this reads every requested week out of a
 * single already-fetched payload.
 */
export const parseEspnSchedule = (schedule) => {
    const rows = Array.isArray(schedule) ? schedule : [];
    const byWeek = {};

    rows.forEach(m => {
        const week = m?.matchupPeriodId;
        if (!Number.isFinite(week)) return;
        const home = m?.home;
        const away = m?.away;
        if (!home || home.teamId === undefined) return;

        const teams = [{
            roster_id: home.teamId,
            starters: [],
            points: home.totalPoints ?? 0,
            projected_points: Number.isFinite(home.totalProjectedPoints) ? home.totalProjectedPoints : null,
            players_points: {},
            starters_points: [],
        }];

        // A bye week has no `away` side at all.
        if (away && away.teamId !== undefined) {
            teams.push({
                roster_id: away.teamId,
                starters: [],
                points: away.totalPoints ?? 0,
                projected_points: Number.isFinite(away.totalProjectedPoints) ? away.totalProjectedPoints : null,
                players_points: {},
                starters_points: [],
            });
        }

        if (!byWeek[week]) byWeek[week] = [];
        byWeek[week].push(teams);
    });

    return byWeek;
};

/**
 * ESPN transactions, in the shape the transactions views already consume
 * (Sleeper's, same target fetchYahooTransactions produces): adds/drops as
 * playerId -> rosterId maps, plus the roster ids involved.
 *
 * An ESPN "transaction" groups one or more player moves under a single type
 * (WAIVER/FREEAGENT/TRADE/ROSTER); ROSTER covers lineup and IR moves with no
 * add/drop at all, so those are dropped once neither map has anything in it.
 */
export const parseEspnTransactions = (transactions) => {
    const rows = Array.isArray(transactions) ? transactions : [];
    const results = [];

    rows.forEach(t => {
        const status = String(t?.status || '').toUpperCase();
        if (status.includes('FAIL') || status.includes('DECLINE')) return;

        const items = Array.isArray(t?.items) ? t.items : [];
        const adds = {};
        const drops = {};
        const rosterIds = new Set();

        items.forEach(item => {
            const playerId = item?.playerId;
            if (playerId === undefined || playerId === null) return;
            const pId = String(playerId);

            if (item.type === 'ADD' && item.toTeamId !== undefined) {
                adds[pId] = item.toTeamId;
                rosterIds.add(item.toTeamId);
            } else if (item.type === 'DROP' && item.fromTeamId !== undefined) {
                drops[pId] = item.fromTeamId;
                rosterIds.add(item.fromTeamId);
            } else if (item.type === 'TRADE') {
                if (item.toTeamId !== undefined) { adds[pId] = item.toTeamId; rosterIds.add(item.toTeamId); }
                if (item.fromTeamId !== undefined) rosterIds.add(item.fromTeamId);
            }
        });

        if (!Object.keys(adds).length && !Object.keys(drops).length) return;

        const rawType = String(t?.type || '').toUpperCase();
        const type = rawType === 'TRADE' ? 'trade' : (rawType === 'WAIVER' ? 'waiver' : 'free_agent');
        const statusUpdated = t?.processDate ?? t?.proposedDate ?? null;

        results.push({
            transaction_id: t?.id ? String(t.id) : null,
            type,
            status: 'complete',
            status_updated: Number.isFinite(statusUpdated) ? statusUpdated : null,
            leg: Number.isFinite(t?.scoringPeriodId) ? t.scoringPeriodId : null,
            adds: Object.keys(adds).length ? adds : null,
            drops: Object.keys(drops).length ? drops : null,
            roster_ids: [...rosterIds],
            draft_picks: [],
            waiver_budget: [],
            settings: Number.isFinite(t?.bidAmount) ? { waiver_bid: t.bidAmount } : null,
        });
    });

    return results.sort((a, b) => (b.status_updated || 0) - (a.status_updated || 0));
};

/**
 * ESPN's draft board, in the pick shape the draft pages already consume for
 * Yahoo (buildYahooDraftBoard's picks[]): round, pick number, the drafting
 * roster, and the drafted player's id.
 *
 * Parses one season's draftDetail response -- espnService.js's fetchESPNDraft
 * is what walks a league's `previous_league_id` chain to fetch each one via
 * that season's query (see platformIds.js's season-qualified ESPN ids).
 * `draftDetail.picks` carries no player name, position, or team at all --
 * only a bare id -- so a caller still needs to resolve it against the shared
 * player dictionary or that season's own roster meta.
 */
export const parseEspnDraftDetail = (draftDetail, { season = null, isAuction = false } = {}) => {
    const picks = Array.isArray(draftDetail?.picks) ? draftDetail.picks : [];
    if (!picks.length) return null;

    const sorted = [...picks].sort((a, b) => (a.overallPickNumber || 0) - (b.overallPickNumber || 0));

    // Same board reconstruction buildYahooDraftBoard uses: round one's picks
    // in order name each draft slot's team, and round two's opening pick says
    // whether the order snakes back. ESPN's own `roundId`/`teamId` per pick
    // make this more reliable than Yahoo's version needed to be (no id
    // parsing), but the draft board UI (Drafts.jsx/DraftGrader.jsx) expects
    // this exact shape regardless of platform.
    const firstRound = sorted.filter(p => p.roundId === 1);
    const slotToRosterId = {};
    firstRound.forEach((p, idx) => { slotToRosterId[idx + 1] = p.teamId; });

    const teams = firstRound.length || new Set(sorted.map(p => p.teamId)).size;
    if (!teams) return null;

    const secondRound = sorted.filter(p => p.roundId === 2);
    const snakes = secondRound.length > 1
        && firstRound.length > 1
        && secondRound[0].teamId === firstRound[firstRound.length - 1].teamId;

    const byRound = new Map();
    const boardPicks = sorted.map(p => {
        const positionInRound = (byRound.get(p.roundId) || 0) + 1;
        byRound.set(p.roundId, positionInRound);

        const slot = (!isAuction && snakes && p.roundId % 2 === 0)
            ? (teams + 1 - positionInRound)
            : positionInRound;

        return {
            round: p.roundId,
            pick_no: p.overallPickNumber,
            draft_slot: slot,
            player_id: String(p.playerId),
            roster_id: p.teamId,
            // NOT the Sleeper-shaped `metadata: {first_name, last_name, ...}`
            // draft picks pages check for a name -- ESPN's draft board carries
            // no player name at all, only this bid amount for an auction pick.
            amount: p.bidAmount,
        };
    });

    return {
        draft_id: `espn-draft-${season || 'current'}`,
        season: season ? String(season) : null,
        status: 'complete',
        type: isAuction ? 'auction' : (snakes ? 'snake' : 'linear'),
        settings: { teams, rounds: Math.max(...sorted.map(p => p.roundId || 1)) },
        metadata: { name: 'Draft' },
        slot_to_roster_id: slotToRosterId,
        picks: boardPicks,
    };
};
