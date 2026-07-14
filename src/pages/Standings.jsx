import React, { useState, useEffect } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers, getAwards } from '../utils/helper';
import { syncActiveLeague } from '../utils/leagueInfo';
import styles from './Standings.module.css';

export default function Standings() {
    const { activeLeague } = useLeague();
    
    // UI State
    const [loadingYears, setLoadingYears] = useState(true);
    const [loading, setLoading] = useState(true);
    const [noStandings, setNoStandings] = useState(false);
    
    // Data State
    const [availableYears, setAvailableYears] = useState([]);
    const [selectedLeagueId, setSelectedLeagueId] = useState('');
    const [selectedYear, setSelectedYear] = useState('');
    const [standingsList, setStandingsList] = useState([]);

    // 1. Traverse Sleeper API to find all historical League IDs connected to this dynasty
    useEffect(() => {
        const fetchYears = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoadingYears(true);
            
            let curId = activeLeague.sleeper_league_id;
            const years = [];
            
            while (curId && curId !== "0" && curId !== 0) {
                try {
                    const res = await fetch(`https://api.sleeper.app/v1/league/${curId}`);
                    if (!res.ok) break;
                    const data = await res.json();
                    years.push({ year: data.season, leagueId: curId, status: data.status });
                    curId = data.previous_league_id;
                } catch (e) { 
                    break; 
                }
            }
            
            setAvailableYears(years);
            if (years.length > 0) {
                setSelectedLeagueId(years[0].leagueId);
                setSelectedYear(years[0].year);
            }
            setLoadingYears(false);
        };
        fetchYears();
    }, [activeLeague]);

    // 2. Fetch the specific Standings and Roster data for the selected year
    useEffect(() => {
        if (!selectedLeagueId || !selectedYear) return;
        
        const loadStandingsData = async () => {
            setLoading(true);
            try {
                if (syncActiveLeague) {
                    syncActiveLeague(activeLeague.sleeper_league_id, activeLeague.league_name);
                }

                const [rostersRes, tmData, podiumsData] = await Promise.all([
                    fetch(`https://api.sleeper.app/v1/league/${selectedLeagueId}/rosters`),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    getAwards(true, activeLeague.sleeper_league_id)
                ]);

                const rostersData = await rostersRes.json();
                let totalGamesPlayed = 0;

                const formatted = rostersData.map(r => {
                    const rosterId = r.roster_id;
                    totalGamesPlayed += (r.settings?.wins || 0) + (r.settings?.losses || 0) + (r.settings?.ties || 0);
                    
                    const yearRosters = tmData.teamManagersMap[selectedYear] || {};
                    const rosterMeta = yearRosters[rosterId] || { team: { name: `Team ${rosterId}`, avatar: '' }, managers: [] };
                    const primaryManagerId = rosterMeta.managers?.[0];

                    const ringYears = (podiumsData || [])
                        .filter(p => {
                            const yRosters = tmData.teamManagersMap[p.year] || {};
                            return yRosters[p.champion]?.managers?.includes(primaryManagerId);
                        })
                        .map(p => p.year);

                    // Calculate the highest streak (Win or Loss) of the season
                    const recordStr = r.metadata?.record || '';
                    let highestStreak = r.metadata?.streak || '-';

                    if (recordStr) {
                        let maxW = 0, maxL = 0;
                        let curW = 0, curL = 0;
                        
                        for (const char of recordStr) {
                            if (char === 'W') { 
                                curW++; curL = 0; 
                                maxW = Math.max(maxW, curW); 
                            } else if (char === 'L') { 
                                curL++; curW = 0; 
                                maxL = Math.max(maxL, curL); 
                            } else { 
                                curW = 0; curL = 0; 
                            }
                        }
                        
                        if (maxW > 0 || maxL > 0) {
                            highestStreak = maxW >= maxL ? `${maxW}W` : `${maxL}L`;
                        }
                    }
                        
                    return {
                        rosterId,
                        teamName: rosterMeta.team?.name || `Team ${rosterId}`,
                        avatar: rosterMeta.team?.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp',
                        wins: r.settings?.wins || 0,
                        losses: r.settings?.losses || 0,
                        ties: r.settings?.ties || 0,
                        fpts: (r.settings?.fpts || 0) + ((r.settings?.fpts_decimal || 0) / 100),
                        fptsAgainst: (r.settings?.fpts_against || 0) + ((r.settings?.fpts_against_decimal || 0) / 100),
                        streak: highestStreak,
                        rings: ringYears.length
                    };
                });
                
                const isCurrentYear = selectedLeagueId === availableYears[0]?.leagueId;
                
                if (totalGamesPlayed === 0 && isCurrentYear && availableYears[0]?.status !== 'complete') {
                    setNoStandings(true);
                } else {
                    setNoStandings(false);
                    formatted.sort((a, b) => {
                        if (b.wins !== a.wins) return b.wins - a.wins;
                        if (b.ties !== a.ties) return b.ties - a.ties;
                        return b.fpts - a.fpts;
                    });
                    setStandingsList(formatted.filter(t => t.rosterId && t.rosterId !== 0)); 
                }
            } catch (e) {
                console.error("Error fetching standings:", e);
            } finally {
                setLoading(false);
            }
        }
        
        loadStandingsData();
    }, [selectedLeagueId, selectedYear, activeLeague, availableYears]);

    if (loadingYears) return <div className={styles.loading}>Loading League History...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.headerControls}>
                <h1 className={styles.headerTitle}>League Standings</h1>
                <select 
                    className={styles.dropdown}
                    value={selectedLeagueId}
                    onChange={(e) => {
                        const sel = availableYears.find(y => y.leagueId === e.target.value);
                        if (sel) {
                            setSelectedLeagueId(sel.leagueId);
                            setSelectedYear(sel.year);
                        }
                    }}
                >
                    {availableYears.map(y => (
                        <option key={y.leagueId} value={y.leagueId}>{y.year} Season</option>
                    ))}
                </select>
            </div>
            
            {loading ? (
                <div className={styles.loading}>Generating Standings...</div>
            ) : noStandings ? (
                <div className={styles.emptyState}>
                    <h3>No Standings to show yet</h3>
                    <p>Check back after the first week of the season.</p>
                </div>
            ) : (
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.textLeft}>Rank</th>
                                <th className={styles.textLeft}>Franchise</th>
                                <th>W</th>
                                <th>L</th>
                                <th>T</th>
                                <th>PCT</th>
                                <th>PF</th>
                                <th>PA</th>
                                <th>Max Streak</th>
                                <th>Rings</th>
                            </tr>
                        </thead>
                        <tbody>
                            {standingsList.map((team, idx) => {
                                const totalGames = team.wins + team.losses + team.ties;
                                const winPct = totalGames ? (team.wins / totalGames).toFixed(3) : '.000';
                                
                                return (
                                    <tr key={team.rosterId} className={styles.row}>
                                        <td className={`${styles.rank} ${idx < 4 ? styles.playoffs : ''}`}>{idx + 1}</td>
                                        <td>
                                            <div className={styles.teamCell}>
                                                <img src={team.avatar} alt="" className={styles.avatar} />
                                                <span className={styles.teamName}>{team.teamName}</span>
                                            </div>
                                        </td>
                                        <td className={styles.statNum}>{team.wins}</td>
                                        <td className={styles.statNum}>{team.losses}</td>
                                        <td className={styles.statNum}>{team.ties}</td>
                                        <td className={styles.statNum}>{winPct.replace(/^0/, '')}</td>
                                        <td className={`${styles.statNum} ${styles.pf}`}>{team.fpts.toFixed(2)}</td>
                                        <td className={styles.statNum}>{team.fptsAgainst.toFixed(2)}</td>
                                        <td className={styles.statNum}>{team.streak}</td>
                                        <td className={styles.statNum}>{team.rings > 0 ? `🏆 ${team.rings}` : '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}