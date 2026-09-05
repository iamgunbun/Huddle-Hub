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

// ESPN's headshot CDN follows a fixed pattern keyed by its own player id -- no
// lookup needed, unlike Yahoo which only gives a photo URL per-player in its
// own roster/player responses.
export const espnHeadshotUrl = (espnPlayerId) =>
    espnPlayerId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnPlayerId}.png` : null;

export const espnTeamDisplayName = (team) =>
    team?.name || [team?.location, team?.nickname].filter(Boolean).join(' ').trim() || `Team ${team?.id ?? ''}`.trim();

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
    const starters = [];
    const reserve = [];
    const playersMeta = {};

    entries.forEach(entry => {
        const parsed = parseEspnRosterEntry(entry, week);
        if (!parsed) return;
        players.push(parsed.id);
        if (parsed.isReserve) reserve.push(parsed.id);
        else if (parsed.isStarter) starters.push(parsed.id);
        playersMeta[parsed.id] = parsed;
    });

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
        avatar: team?.logo || '/brand.png',
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
 * ESPN keeps one league id across every season (unlike Sleeper/Yahoo, which
 * mint a new one each year), so there is no `previous_league_id` chain to
 * walk here -- only the current season's board is available through this
 * parser. `draftDetail.picks` also carries no player name, position, or team
 * at all -- only a bare id -- so a caller still needs to resolve it against
 * the shared player dictionary or that team's own current roster meta.
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
