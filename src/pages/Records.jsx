import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueRecords, getLeagueTeamManagers } from '../utils/helper';
import styles from './Records.module.css';

export default function RecordsPage() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    
    const [recordsData, setRecordsData] = useState(null);
    const [teamManagers, setTeamManagers] = useState(null);
    const [viewMode, setViewMode] = useState('regular'); // 'regular' or 'playoff'
    const [displayLimit, setDisplayLimit] = useState(5); // Dynamic toggle limit (5 or 10)

    useEffect(() => {
        const loadRecordsObj = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [rData, tmData] = await Promise.all([
                    getLeagueRecords(true, activeLeague.sleeper_league_id),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id)
                ]);
                setRecordsData(rData);
                setTeamManagers(tmData);
            } catch (e) {
                console.error("Failed to compile lifetime league records:", e);
            } finally {
                setLoading(false);
            }
        };
        loadRecordsObj();
    }, [activeLeague]);

    // Robust identity resolver returning names, avatars, and platform handles across years
    const getFullTeamInfo = (rosterId, year) => {
        if (!teamManagers || !teamManagers.teamManagersMap) {
            return { name: 'Unknown Team', avatar: 'https://sleepercdn.com/images/v2/icons/player_default.webp', handle: '' };
        }
        const yearRosters = teamManagers.teamManagersMap[year] || teamManagers.teamManagersMap[teamManagers.currentSeason] || {};
        const roster = yearRosters[rosterId];
        if (roster) {
            const managerId = roster.managers?.[0];
            const handle = teamManagers.users?.[managerId]?.display_name || '';
            return {
                name: roster.team?.name || `Team ${rosterId}`,
                avatar: roster.team?.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp',
                handle: handle
            };
        }
        return { name: `Team ${rosterId}`, avatar: 'https://sleepercdn.com/images/v2/icons/player_default.webp', handle: '' };
    };

    // Resolves active display profiles
    const getManagerDisplayName = (managerId) => {
        if (!teamManagers) return 'Unknown Manager';
        if (teamManagers.users?.[managerId]?.display_name) {
            return teamManagers.users[managerId].display_name;
        }
        for (const year of Object.keys(teamManagers.teamManagersMap || {})) {
            const rosters = teamManagers.teamManagersMap[year] || {};
            for (const rId in rosters) {
                if (rosters[rId].managers?.includes(managerId)) {
                    return rosters[rId].team?.name || 'Former Manager';
                }
            }
        }
        return 'Former Manager';
    };

    // Filter Active Dataset based on Tab Control Selection
    const activeDataset = useMemo(() => {
        if (!recordsData) return null;
        return viewMode === 'regular' ? recordsData.regularSeasonData : recordsData.playoffData;
    }, [recordsData, viewMode]);

    // Compile All-Time Leaderboard Matrix (Active members only)
    const leaderboard = useMemo(() => {
        if (!activeDataset?.leagueManagerRecords || !teamManagers) return [];
        
        const activeManagers = new Set();
        const currentRosters = teamManagers.teamManagersMap[teamManagers.currentSeason] || {};
        Object.values(currentRosters).forEach(roster => {
            if (roster.managers) {
                roster.managers.forEach(mId => activeManagers.add(mId));
            }
        });

        const rows = Object.entries(activeDataset.leagueManagerRecords)
            .filter(([managerId]) => activeManagers.has(managerId))
            .map(([managerId, stat]) => {
                const totalGames = stat.wins + stat.losses + stat.ties;
                const pct = totalGames ? (stat.wins / totalGames) : 0;
                return {
                    managerId,
                    name: getManagerDisplayName(managerId),
                    wins: stat.wins,
                    losses: stat.losses,
                    ties: stat.ties,
                    pct: pct.toFixed(3).replace(/^0/, ''),
                    fptsFor: stat.fptsFor.toFixed(2),
                    fptsAgainst: stat.fptsAgainst.toFixed(2),
                    rawPct: pct
                };
            });

        return rows.sort((a, b) => b.rawPct - a.rawPct || parseFloat(b.fptsFor) - parseFloat(a.fptsFor));
    }, [activeDataset, teamManagers]);

    // Head-to-Head Extremes
    const blowouts = useMemo(() => {
        if (!activeDataset?.allTimeMatchupDifferentials) return [];
        return [...activeDataset.allTimeMatchupDifferentials].sort((a, b) => b.differential - a.differential);
    }, [activeDataset]);

    const closestMatchups = useMemo(() => {
        if (!activeDataset?.allTimeMatchupDifferentials) return [];
        return [...activeDataset.allTimeMatchupDifferentials].sort((a, b) => a.differential - b.differential);
    }, [activeDataset]);

    // Tie-breaker utility ensuring index exclusion
    const checkForTie = (currentVal, entireList, valueKey, currentIndex) => {
        if (!entireList || entireList.length <= 1) return false;
        return entireList.some((item, idx) => idx !== currentIndex && item[valueKey] === currentVal);
    };

    if (loading) return <div className={styles.loading}>Parsing All-Time Stat Records...</div>;
    if (!activeDataset) return <div className={styles.loading}>No Historical Data Found.</div>;

    return (
        <div className={styles.container}>
            <h1 className={styles.headerTitle}>League Record Book</h1>

            {/* View Switching Navigation Controls */}
            <div className={styles.controlsRow}>
                <div className={styles.viewToggles}>
                    <button className={`${styles.toggleBtn} ${viewMode === 'regular' ? styles.active : ''}`} onClick={() => setViewMode('regular')}>
                        Regular Season
                    </button>
                    <button className={`${styles.toggleBtn} ${viewMode === 'playoff' ? styles.active : ''}`} onClick={() => setViewMode('playoff')}>
                        Playoffs
                    </button>
                </div>
                
                <select 
                    className={styles.limitDropdown} 
                    value={displayLimit} 
                    onChange={(e) => setDisplayLimit(parseInt(e.target.value))}
                >
                    <option value={5}>Show Top 5</option>
                    <option value={10}>Show Top 10</option>
                </select>
            </div>

            {/* --- ALL-TIME LEADERBOARD SECTION --- */}
            <div className={styles.sectionBlock}>
                <h2 className={styles.sectionHeading}>📊 Lifetime Franchise Leaderboard</h2>
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.textLeft}>Rank</th>
                                <th className={styles.textLeft}>Manager</th>
                                <th>W</th>
                                <th>L</th>
                                <th>T</th>
                                <th>PCT</th>
                                <th>Points For</th>
                                <th>Points Against</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leaderboard.map((row, idx) => (
                                <tr key={row.managerId} className={styles.row}>
                                    <td className={styles.rankNum}>{idx + 1}</td>
                                    <td className={styles.managerNameCell}>{row.name}</td>
                                    <td className={styles.statNum}>{row.wins}</td>
                                    <td className={styles.statNum}>{row.losses}</td>
                                    <td className={styles.statNum}>{row.ties}</td>
                                    <td className={`${styles.statNum} ${styles.pctCol}`}>{row.pct}</td>
                                    <td className={`${styles.statNum} ${styles.goldText}`}>{row.fptsFor}</td>
                                    <td className={styles.statNum}>{row.fptsAgainst}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* --- ALL-TIME SEASON BENCHMARKS --- */}
            <div className={styles.sectionBlock}>
                <h2 className={styles.sectionHeading}>📈 All-Time Season Benchmarks</h2>
                <div className={styles.seasonLeaderboardsGrid}>
                    
                    {/* All-Time Highest Season Points */}
                    <div className={styles.tableCardFull}>
                        <h3 className={styles.cardHeader}>
                            All-Time Highest Season Points <span className={styles.subHeaderLabel}>Ranked by PPG</span>
                        </h3>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={{ width: '50px' }}></th>
                                        <th className={styles.textLeft}>Manager</th>
                                        <th>Year</th>
                                        <th>Total Points</th>
                                        <th>PPG</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(activeDataset.mostSeasonLongPoints || []).slice(0, displayLimit).map((s, i, arr) => {
                                        const team = getFullTeamInfo(s.rosterID, s.year);
                                        const tied = checkForTie(s.fptsPerGame, arr, 'fptsPerGame', i);
                                        const totalPoints = s.fpts || (parseFloat(s.fptsPerGame) * 14); 
                                        
                                        return (
                                            <tr key={`high-season-${i}`} className={styles.row}>
                                                <td className={styles.rankNum} style={{ textAlign: 'center' }}>{i + 1}</td>
                                                <td>
                                                    <div className={styles.managerCellLayout}>
                                                        <img src={team.avatar} alt="Avatar" className={styles.tableAvatar} />
                                                        <div className={styles.managerIdentityStack}>
                                                            <span className={styles.tableTeamName}>{team.name}</span>
                                                            {team.handle && <span className={styles.tableHandle}>{team.handle}</span>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className={styles.statNum} style={{ color: '#94a3b8' }}>{s.year}</td>
                                                <td className={styles.statNum}>{totalPoints.toFixed(2)}</td>
                                                <td className={`${styles.statNum} ${styles.pctCol}`}>
                                                    {parseFloat(s.fptsPerGame).toFixed(2)}{tied && <span className={styles.tieBadge}>T</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* All-Time Lowest Season Points */}
                    <div className={styles.tableCardFull}>
                        <h3 className={styles.cardHeader}>
                            All-Time Lowest Season Points <span className={styles.subHeaderLabel}>Ranked by PPG</span>
                        </h3>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={{ width: '50px' }}></th>
                                        <th className={styles.textLeft}>Manager</th>
                                        <th>Year</th>
                                        <th>Total Points</th>
                                        <th>PPG</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(activeDataset.leastSeasonLongPoints || []).slice(0, displayLimit).map((s, i, arr) => {
                                        const team = getFullTeamInfo(s.rosterID, s.year);
                                        const tied = checkForTie(s.fptsPerGame, arr, 'fptsPerGame', i);
                                        const totalPoints = s.fpts || (parseFloat(s.fptsPerGame) * 14);
                                        
                                        return (
                                            <tr key={`low-season-${i}`} className={styles.row}>
                                                <td className={styles.rankNum} style={{ textAlign: 'center' }}>{i + 1}</td>
                                                <td>
                                                    <div className={styles.managerCellLayout}>
                                                        <img src={team.avatar} alt="Avatar" className={styles.tableAvatar} />
                                                        <div className={styles.managerIdentityStack}>
                                                            <span className={styles.tableTeamName}>{team.name}</span>
                                                            {team.handle && <span className={styles.tableHandle}>{team.handle}</span>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className={styles.statNum} style={{ color: '#94a3b8' }}>{s.year}</td>
                                                <td className={styles.statNum}>{totalPoints.toFixed(2)}</td>
                                                <td className={`${styles.statNum}`} style={{ color: '#ff2a6d', fontWeight: '800' }}>
                                                    {parseFloat(s.fptsPerGame).toFixed(2)}{tied && <span className={styles.tieBadge}>T</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </div>

            {/* --- HISTORICAL WEEKLY MILESTONES GRID --- */}
            <div className={styles.sectionBlock}>
                <h2 className={styles.sectionHeading}>🎯 Historical Milestones</h2>
                <div className={styles.recordsGrid}>
                    
                    {/* Single-Week Highs */}
                    <div className={styles.recordCard}>
                        <h3 className={styles.cardHeader}>Single-Week Highs</h3>
                        <div className={styles.listContainer}>
                            {(activeDataset.leagueWeekHighs || []).slice(0, displayLimit).map((h, i, arr) => {
                                const team = getFullTeamInfo(h.rosterID, h.year);
                                const tied = checkForTie(h.fpts, arr, 'fpts', i);
                                return (
                                    <div key={`wh-${i}`} className={styles.recordRowItem}>
                                        <div className={styles.rowPlacement}>#{i + 1}</div>
                                        <div className={styles.textGroup}>
                                            <div className={styles.metaLabel}>{h.year} • Wk {h.week}</div>
                                            <div className={styles.holderTitle}>{team.name}</div>
                                        </div>
                                        <div className={styles.scoreMetric}>
                                            {h.fpts.toFixed(2)}{tied && <span className={styles.tieBadge}>T</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Single-Week Lows */}
                    <div className={styles.recordCard}>
                        <h3 className={styles.cardHeader}>Single-Week Lows</h3>
                        <div className={styles.listContainer}>
                            {(activeDataset.leagueWeekLows || []).slice(0, displayLimit).map((l, i, arr) => {
                                const team = getFullTeamInfo(l.rosterID, l.year);
                                const tied = checkForTie(l.fpts, arr, 'fpts', i);
                                return (
                                    <div key={`wl-${i}`} className={styles.recordRowItem}>
                                        <div className={styles.rowPlacement}>#{i + 1}</div>
                                        <div className={styles.textGroup}>
                                            <div className={styles.metaLabel}>{l.year} • Wk {l.week}</div>
                                            <div className={styles.holderTitle}>{team.name}</div>
                                        </div>
                                        <div className={styles.scoreMetric} style={{ color: '#ff2a6d' }}>
                                            {l.fpts.toFixed(2)}{tied && <span className={styles.tieBadge}>T</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Highest Season Averages */}
                    <div className={styles.recordCard}>
                        <h3 className={styles.cardHeader}>Highest Season Averages</h3>
                        <div className={styles.listContainer}>
                            {(activeDataset.mostSeasonLongPoints || []).slice(0, displayLimit).map((s, i, arr) => {
                                const team = getFullTeamInfo(s.rosterID, s.year);
                                const tied = checkForTie(s.fptsPerGame, arr, 'fptsPerGame', i);
                                return (
                                    <div key={`sh-${i}`} className={styles.recordRowItem}>
                                        <div className={styles.rowPlacement}>#{i + 1}</div>
                                        <div className={styles.textGroup}>
                                            <div className={styles.metaLabel}>{s.year} Campaign</div>
                                            <div className={styles.holderTitle}>{team.name}</div>
                                        </div>
                                        <div className={styles.scoreMetric}>
                                            {parseFloat(s.fptsPerGame).toFixed(2)}{tied && <span className={styles.tieBadge}>T</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Lowest Season Averages */}
                    <div className={styles.recordCard}>
                        <h3 className={styles.cardHeader}>Lowest Season Averages</h3>
                        <div className={styles.listContainer}>
                            {(activeDataset.leastSeasonLongPoints || []).slice(0, displayLimit).map((s, i, arr) => {
                                const team = getFullTeamInfo(s.rosterID, s.year);
                                const tied = checkForTie(s.fptsPerGame, arr, 'fptsPerGame', i);
                                return (
                                    <div key={`sl-${i}`} className={styles.recordRowItem}>
                                        <div className={styles.rowPlacement}>#{i + 1}</div>
                                        <div className={styles.textGroup}>
                                            <div className={styles.metaLabel}>{s.year} Campaign</div>
                                            <div className={styles.holderTitle}>{team.name}</div>
                                        </div>
                                        <div className={styles.scoreMetric} style={{ color: '#ff2a6d' }}>
                                            {parseFloat(s.fptsPerGame).toFixed(2)}{tied && <span className={styles.tieBadge}>T</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    
                </div>
            </div>

            {/* --- MATCHUP EXTREMES SECTION --- */}
            <div className={styles.extremesSectionWrapper}>
                <h2 className={styles.sectionHeading}>⚔️ Historic Head-to-Head Extremes</h2>
                <div className={styles.extremesGrid}>
                    {/* Biggest Blowouts */}
                    <div className={styles.recordCard}>
                        <h3 className={styles.cardHeader}>All-Time Biggest Blowouts</h3>
                        <div className={styles.listContainer}>
                            {blowouts.slice(0, displayLimit).map((b, i, arr) => {
                                const homeTeam = getFullTeamInfo(b.home.rosterID, b.year);
                                const awayTeam = getFullTeamInfo(b.away.rosterID, b.year);
                                const tied = checkForTie(b.differential, arr, 'differential', i);
                                return (
                                    <div key={`bb-${i}`} className={styles.extremeRowItem}>
                                        <div className={styles.rowPlacement} style={{ marginRight: '15px' }}>#{i + 1}</div>
                                        <div className={styles.textGroup}>
                                            <div className={styles.extremeMeta}>{b.year} • Week {b.week}</div>
                                            <div className={styles.matchupDetails}>
                                                <span className={styles.winnerName}>{homeTeam.name} ({b.home.fpts.toFixed(1)})</span>
                                                <span className={styles.vsText}>def.</span>
                                                <span className={styles.loserName}>{awayTeam.name} ({b.away.fpts.toFixed(1)})</span>
                                            </div>
                                        </div>
                                        <div className={styles.diffValue}>
                                            +{b.differential.toFixed(2)}{tied && <span className={styles.tieBadge}>T</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Closest Matches */}
                    <div className={styles.recordCard}>
                        <h3 className={styles.cardHeader}>All-Time Closest Heartbreaks</h3>
                        <div className={styles.listContainer}>
                            {closestMatchups.slice(0, displayLimit).map((c, i, arr) => {
                                const homeTeam = getFullTeamInfo(c.home.rosterID, c.year);
                                const awayTeam = getFullTeamInfo(c.away.rosterID, c.year);
                                const tied = checkForTie(c.differential, arr, 'differential', i);
                                return (
                                    <div key={`cm-${i}`} className={styles.extremeRowItem}>
                                        <div className={styles.rowPlacement} style={{ marginRight: '15px' }}>#{i + 1}</div>
                                        <div className={styles.textGroup}>
                                            <div className={styles.extremeMeta}>{c.year} • Week {c.week}</div>
                                            <div className={styles.matchupDetails}>
                                                <span className={styles.winnerName}>{homeTeam.name} ({c.home.fpts.toFixed(1)})</span>
                                                <span className={styles.vsText}>def.</span>
                                                <span className={styles.loserName}>{awayTeam.name} ({c.away.fpts.toFixed(1)})</span>
                                            </div>
                                        </div>
                                        <div className={styles.diffValue} style={{ color: '#00ceb8' }}>
                                            {c.differential.toFixed(2)}{tied && <span className={styles.tieBadge}>T</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}