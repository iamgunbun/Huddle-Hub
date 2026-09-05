import React, { useState, useEffect } from 'react';
import { useLeague } from '../../context/LeagueContext';
import { getLeagueStandings, getLeagueRosters, getLeagueTeamManagers, getLeagueData, loadPlayers, getNflState, predictScores } from '../../utils/helper';
import { getTeamFromTeamManagers } from '../../utils/helperFunctions/universalFunctions';
import { fetchYahooScoreboardWeeks } from '../../utils/yahooService';
import {
    simulateSeason,
    blendedScoringMean,
    pairMatchupRows,
    toWholePercentages,
    makeRng,
    seedFrom,
    DEFAULT_SCORE_VOLATILITY,
} from '../../utils/seasonSimulation';
import { movementFromSnapshots, withSnapshot } from '../../utils/rankMovement';
import { resolveRosterPlayers } from '../../utils/playerPool';
import styles from './Projections.module.css';

const isYahooLeagueId = (id) => !!id && (String(id).includes('.') || !/^\d+$/.test(String(id)));
const SNAPSHOT_KEY = (leagueId) => `powerRankOrder_${leagueId}`;

const readSnapshots = (leagueId) => {
    try {
        return JSON.parse(localStorage.getItem(SNAPSHOT_KEY(leagueId))) || {};
    } catch {
        return {};
    }
};

const writeSnapshots = (leagueId, snapshots) => {
    try {
        localStorage.setItem(SNAPSHOT_KEY(leagueId), JSON.stringify(snapshots));
    } catch (e) {
        console.warn("Couldn't record this week's power ranking order:", e);
    }
};

/**
 * The games still to be played.
 *
 * Odds that ignore the schedule can't tell a team facing the top three from one
 * facing the bottom three, so the real remaining fixtures are fetched rather
 * than approximated. Weeks already complete are skipped -- replaying them would
 * count those results twice.
 */
const fetchRemainingSchedule = async (leagueId, firstWeek, lastWeek) => {
    const weeks = [];
    for (let w = firstWeek; w <= lastWeek; w++) weeks.push(w);
    if (!weeks.length) return [];

    try {
        if (isYahooLeagueId(leagueId)) {
            const scoreboard = await fetchYahooScoreboardWeeks(leagueId, weeks);
            return scoreboard
                .filter(m => !m.played && Number.isFinite(m.week))
                .map(m => ({ week: m.week, home: m.teams[0]?.roster_id, away: m.teams[1]?.roster_id }))
                .filter(g => g.home !== undefined && g.away !== undefined);
        }

        const weekly = await Promise.all(weeks.map(async (w) => {
            const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`);
            if (!res.ok) return [];
            return pairMatchupRows(await res.json(), w);
        }));
        return weekly.flat();
    } catch (e) {
        console.warn("Couldn't read the remaining schedule; odds will assume an even run-in:", e);
        return [];
    }
};

/**
 * A stand-in schedule for when the real one can't be read.
 *
 * Better than abandoning the odds entirely, but it assumes everyone plays
 * everyone equally, so strength of schedule drops out. The panel says as much
 * rather than presenting these as the same thing.
 */
const buildRoundRobin = (rosterIds, weeksRemaining, startWeek) => {
    const games = [];
    const ids = [...rosterIds];
    if (ids.length < 2) return games;
    if (ids.length % 2) ids.push(null);

    for (let w = 0; w < weeksRemaining; w++) {
        for (let i = 0; i < ids.length / 2; i++) {
            const home = ids[i];
            const away = ids[ids.length - 1 - i];
            if (home !== null && away !== null) games.push({ week: startWeek + w, home, away });
        }
        ids.splice(1, 0, ids.pop());
    }
    return games;
};

export default function ProjectionsPanel() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [powerRankings, setPowerRankings] = useState([]);
    const [preDraftMode, setPreDraftMode] = useState(false);
    const [scheduleKnown, setScheduleKnown] = useState(true);
    const [rosterCoverage, setRosterCoverage] = useState(1);

    useEffect(() => {
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) {
                setLoading(false);
                return;
            }
            setLoading(true);

            try {
                const id = activeLeague.sleeper_league_id;

                const [standingsData, rostersData, managersData, currentLeagueData, pData, nflState] = await Promise.all([
                    getLeagueStandings(id),
                    getLeagueRosters(id),
                    getLeagueTeamManagers(id),
                    getLeagueData(id),
                    loadPlayers(id),
                    getNflState()
                ]);

                const standings = standingsData?.standingsInfo || {};
                const rosters = rostersData?.rosters || {};
                const playersInfo = pData?.players || {};
                const playersByName = pData?.playersByName || {};
                // In a Yahoo league the roster holds Yahoo ids while the shared
                // dictionary is keyed by Sleeper's crosswalk, so this is what
                // lets a player the crosswalk misses still be identified.
                const platformMeta = rostersData?.yahooPlayersMeta || {};
                let worstCoverage = 1;

                const week = (nflState?.display_week && nflState.display_week > 0) ? nflState.display_week : 1;
                const playoffSpots = Number(currentLeagueData?.settings?.playoff_teams) || 6;
                const playoffWeekStart = Number(currentLeagueData?.settings?.playoff_week_start) || 15;
                const lastRegularWeek = Math.max(1, playoffWeekStart - 1);

                const teams = [];
                let totalPlayersFound = 0;
                let weeksCompleted = 0;

                for (const rosterID in rosters) {
                    const teamStats = standings[rosterID] || { wins: 0, losses: 0, ties: 0, fpts: 0 };
                    const teamMeta = getTeamFromTeamManagers(managersData, rosterID, currentLeagueData?.season || new Date().getFullYear());
                    const roster = rosters[rosterID];

                    // What this roster would score in a typical week if the
                    // manager started their best available lineup.
                    let rosterStrength = 0;
                    if (roster?.players?.length) {
                        totalPlayersFound += roster.players.length;
                        // A plain id lookup silently drops every player the
                        // crosswalk misses, so each team's strength came from a
                        // different arbitrary subset of its roster -- which is
                        // what produced a huge, meaningless spread in the odds.
                        const { players: rosterPlayers, coverage } = resolveRosterPlayers(
                            roster.players, playersInfo, playersByName, platformMeta
                        );
                        worstCoverage = Math.min(worstCoverage, coverage);
                        const raw = predictScores(rosterPlayers, week, currentLeagueData);
                        rosterStrength = Number.isFinite(raw) ? raw : 0;
                    }

                    const wins = Number(teamStats.wins) || 0;
                    const losses = Number(teamStats.losses) || 0;
                    const ties = Number(teamStats.ties) || 0;
                    const pointsFor = Number(teamStats.fpts) || 0;
                    const weeksPlayed = wins + losses + ties;
                    weeksCompleted = Math.max(weeksCompleted, weeksPlayed);

                    const mean = blendedScoringMean({ pointsFor, weeksPlayed, rosterStrength });

                    teams.push({
                        rosterId: String(rosterID),
                        name: teamMeta?.name || 'Unknown Team',
                        avatar: teamMeta?.avatar,
                        wins,
                        losses,
                        ties,
                        pointsFor,
                        mean,
                        stdDev: Math.max(1, mean * DEFAULT_SCORE_VOLATILITY),
                    });
                }

                if (!teams.length) {
                    setPowerRankings([]);
                    setPreDraftMode(false);
                    setLoading(false);
                    return;
                }

                // A ranking built from partly-identified rosters compares teams
                // on how much of each could be looked up, not on how good they
                // are. Say so rather than presenting it as the same thing.
                if (worstCoverage < 0.9) {
                    console.warn(
                        `Power rankings: only ${Math.round(worstCoverage * 100)}% of the thinnest roster could be identified. ` +
                        `Strength estimates for that team understate it.`
                    );
                }
                setRosterCoverage(worstCoverage);

                // Nobody has drafted yet: there is nothing to tell the teams
                // apart, so say so rather than inventing a ranking.
                const isPreDraft = totalPlayersFound === 0;
                setPreDraftMode(isPreDraft);

                // Only weeks nobody has played yet. Replaying a completed week
                // would count its result twice.
                const firstRemainingWeek = Math.min(weeksCompleted + 1, lastRegularWeek + 1);
                let schedule = await fetchRemainingSchedule(id, firstRemainingWeek, lastRegularWeek);

                const scheduleFound = schedule.length > 0 || firstRemainingWeek > lastRegularWeek;
                if (!scheduleFound) {
                    schedule = buildRoundRobin(
                        teams.map(t => t.rosterId),
                        Math.max(0, lastRegularWeek - weeksCompleted),
                        firstRemainingWeek
                    );
                }
                setScheduleKnown(scheduleFound);

                const simulated = simulateSeason({
                    teams,
                    schedule,
                    playoffSpots,
                    iterations: 2000,
                    // Seeded on the league and week so the odds are stable
                    // between renders and only move when the season does.
                    rng: makeRng(seedFrom(id, week, teams.length)),
                });

                const oddsByRoster = new Map(simulated.map(s => [s.rosterId, s]));
                const ranked = teams
                    .map(t => ({ ...t, ...oddsByRoster.get(t.rosterId) }))
                    .sort((a, b) =>
                        (b.playoffOdds - a.playoffOdds)
                        || (b.titleOdds - a.titleOdds)
                        || (b.mean - a.mean)
                    );

                // Whole percentages that still add up: rounding each on its own
                // is what makes a column of odds total 97% or 104%.
                const poPercent = toWholePercentages(ranked.map(t => t.playoffOdds), Math.min(playoffSpots, ranked.length));
                const champPercent = toWholePercentages(ranked.map(t => t.titleOdds), 1);

                const order = ranked.map(t => t.rosterId);
                const snapshots = readSnapshots(id);
                const movement = movementFromSnapshots(order, snapshots, week);
                writeSnapshots(id, withSnapshot(snapshots, week, order));

                setPowerRankings(ranked.map((team, i) => ({
                    ...team,
                    po: poPercent[i],
                    champ: champPercent[i],
                    movement: movement.get(team.rosterId) ?? null,
                })));
            } catch (e) {
                console.error("Projections Error:", e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [activeLeague]);

    const movementTitle = (movement) => {
        if (movement === null || movement === undefined) return 'Newly ranked';
        if (movement > 0) return `Up ${movement} since last week`;
        if (movement < 0) return `Down ${Math.abs(movement)} since last week`;
        return 'No change since last week';
    };

    if (loading) {
        return <div className={styles.card}><p style={{ color: '#94a3b8', padding: '20px', textAlign: 'center', margin: 0, fontStyle: 'italic' }}>Simulating Matchups...</p></div>;
    }

    if (powerRankings.length === 0) {
        return (
            <div className={styles.card}>
                <h3 style={{ textAlign: 'center', fontSize: '1.3em', fontWeight: '500', color: '#f8fafc', padding: '15px 0', margin: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    Live Projections
                </h3>
                
                <p style={{ color: '#94a3b8', padding: '30px 20px', textAlign: 'center', margin: 0, fontStyle: 'italic', fontSize: '0.9em', lineHeight: '1.6' }}>
                    <i className="material-icons" style={{ display: 'block', fontSize: '32px', color: '#64748b', marginBottom: '10px' }}>layers_clear</i>
                    No roster configurations found.<br />Ensure franchise slots exist in your league to launch projections.
                </p>
            </div>
        );
    }

    return (
        <div className={styles.card}>
            <div style={{ padding: '15px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'center' }}>
                <h3 style={{ fontSize: '1.3em', fontWeight: '500', color: '#f8fafc', margin: 0 }}>Live Projections</h3>
                {!preDraftMode && rosterCoverage < 0.9 && (
                    <span style={{ color: '#94a3b8', fontSize: '0.68em', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginTop: '4px' }}>
                        Some roster players unidentified &mdash; strengths approximate
                    </span>
                )}
                {!preDraftMode && !scheduleKnown && (
                    <span style={{ color: '#94a3b8', fontSize: '0.68em', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginTop: '4px' }}>
                        Even run-in assumed &mdash; schedule unavailable
                    </span>
                )}
                {preDraftMode && (
                    <span style={{ color: '#eebf1c', fontSize: '0.7em', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginTop: '4px' }}>
                        <i className="material-icons" style={{ fontSize: '10px', verticalAlign: 'middle', marginRight: '4px' }}>auto_awesome</i>
                        Pre-Draft Uniform Baseline
                    </span>
                )}
            </div>
            
            {powerRankings.map((team, i) => (
                <div key={team.rosterId} className={styles.teamRow}>
                    <div className={styles.rankBadge}>
                        {preDraftMode ? '-' : (i + 1)} 
                    </div>
                    {/* Movement since the last completed week. Null means the
                        team wasn't ranked then, which is not the same as
                        having held its position. */}
                    <div className={styles.movement} title={movementTitle(team.movement)}>
                        {team.movement === null || team.movement === undefined ? (
                            <span className={styles.movementNew}>•</span>
                        ) : team.movement > 0 ? (
                            <span className={styles.movementUp}>▲{team.movement}</span>
                        ) : team.movement < 0 ? (
                            <span className={styles.movementDown}>▼{Math.abs(team.movement)}</span>
                        ) : (
                            <span className={styles.movementFlat}>–</span>
                        )}
                    </div>
                    <img src={team.avatar} alt="Avatar" className={styles.avatar} onError={(e) => e.target.src = 'https://sleepercdn.com/images/v2/icons/league_default.webp'} />
                    
                    <div className={styles.teamInfo} style={{ flex: 1, minWidth: 0, paddingRight: '10px' }}>
                        <span className={styles.teamName} style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {team.name}
                        </span>
                        <span className={styles.teamRecord}>{team.wins} - {team.losses}</span>
                    </div>
                    
                    <div className={styles.oddsInfo}>
                        <div className={styles.oddsRow}>
                            <span className={styles.oddsLabel}>PO:</span> 
                            <span className={styles.oddsValue}>{team.po}%</span>
                        </div>
                        <div className={styles.oddsRow}>
                            <span className={styles.oddsLabel}>Champ:</span> 
                            <span className={styles.oddsValue}>{team.champ}%</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}