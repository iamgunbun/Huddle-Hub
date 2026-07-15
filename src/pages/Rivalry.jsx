import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueRecords, getLeagueTeamManagers } from '../utils/helper';
import { syncActiveLeague } from '../utils/leagueInfo';
import { supabase } from '../supabaseClient';
import styles from './Rivalry.module.css';

export default function Rivalry() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    
    const [recordsData, setRecordsData] = useState(null);
    const [teamManagersData, setTeamManagersData] = useState(null);
    const [managersList, setManagersList] = useState([]);

    const [managerA, setManagerA] = useState('');
    const [managerB, setManagerB] = useState('');

    const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    useEffect(() => {
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);

            try {
                localStorage.removeItem("records");
                
                if (syncActiveLeague) {
                    syncActiveLeague(activeLeague.sleeper_league_id, activeLeague.league_name);
                }

                const [rData, tmData] = await Promise.all([
                    getLeagueRecords(true, activeLeague.sleeper_league_id),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id)
                ]);

                setRecordsData(rData);
                setTeamManagersData(tmData);

                const currentSeason = tmData.currentSeason;
                const activeRosters = tmData.teamManagersMap[currentSeason] || {};

                const mList = Object.entries(activeRosters)
                    .map(([rId, rData]) => ({
                        managerId: rData.managers?.[0],
                        teamName: rData.team.name,
                        avatar: rData.team.avatar
                    }))
                    .filter(m => m.managerId);
                
                setManagersList(mList);

                let myManagerId = null;
                const { data: sessionData } = await supabase.auth.getSession();
                
                if (sessionData?.session?.user) {
                    const { data: ulData } = await supabase
                        .from('user_leagues')
                        .select('team_name')
                        .eq('user_id', sessionData.session.user.id)
                        .eq('league_id', activeLeague.id)
                        .single();

                    const searchName = normalizeStr(ulData?.team_name);
                    
                    if (searchName && searchName !== normalizeStr('commissioner team')) {
                        const matchedManager = mList.find(m => normalizeStr(m.teamName) === searchName);
                        if (matchedManager) {
                            myManagerId = matchedManager.managerId;
                        } else {
                            const matchedByDisplay = mList.find(m => {
                                const sUser = tmData.users[m.managerId];
                                return normalizeStr(sUser?.display_name) === searchName || normalizeStr(sUser?.username) === searchName;
                            });
                            if (matchedByDisplay) myManagerId = matchedByDisplay.managerId;
                        }
                    }
                }

                if (mList.length > 1) {
                    if (myManagerId) {
                        setManagerA(myManagerId);
                        const otherManager = mList.find(m => m.managerId !== myManagerId);
                        setManagerB(otherManager ? otherManager.managerId : mList[0].managerId);
                    } else {
                        setManagerA(mList[0].managerId);
                        setManagerB(mList[1].managerId);
                    }
                }

            } catch (e) {
                console.error("Failed to load rivalry data:", e);
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [activeLeague]);

    const rivalryStats = useMemo(() => {
        if (!managerA || !managerB || !recordsData || !teamManagersData) return null;

        const allMatches = [
            ...(recordsData.regularSeasonData?.allTimeMatchupDifferentials || []).map(m => ({ ...m, type: 'REG SEASON' })),
            ...(recordsData.playoffData?.allTimeMatchupDifferentials || []).map(m => ({ ...m, type: 'PLAYOFFS' }))
        ];

        const history = [];
        let winsA = 0;
        let winsB = 0;
        let ties = 0;
        let pointsA = 0;
        let pointsB = 0;
        let biggestBlowout = null;
        let closestMatch = null;

        allMatches.forEach(match => {
            const year = match.year;
            const rostersThatYear = teamManagersData.teamManagersMap[year];
            if (!rostersThatYear) return;

            const homeManager = rostersThatYear[match.home.rosterID]?.managers?.[0];
            const awayManager = rostersThatYear[match.away.rosterID]?.managers?.[0];

            if (!homeManager || !awayManager) return;

            const isMatch = (homeManager === managerA && awayManager === managerB) || 
                            (homeManager === managerB && awayManager === managerA);
            
            if (isMatch) {
                let scoreA, scoreB;
                if (homeManager === managerA) {
                    scoreA = match.home.fpts;
                    scoreB = match.away.fpts;
                } else {
                    scoreA = match.away.fpts;
                    scoreB = match.home.fpts;
                }

                pointsA += scoreA;
                pointsB += scoreB;

                if (scoreA > scoreB) winsA++;
                else if (scoreB > scoreA) winsB++;
                else ties++;

                const diff = Math.abs(scoreA - scoreB);
                const matchRecord = { ...match, scoreA, scoreB, diff };

                if (!biggestBlowout || diff > biggestBlowout.diff) biggestBlowout = matchRecord;
                if (!closestMatch || diff < closestMatch.diff) closestMatch = matchRecord;

                history.push(matchRecord);
            }
        });

        history.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            const weekA = parseInt(a.week) || 99;
            const weekB = parseInt(b.week) || 99;
            return weekB - weekA;
        });

        return { history, winsA, winsB, ties, pointsA, pointsB, biggestBlowout, closestMatch };
    }, [managerA, managerB, recordsData, teamManagersData]);

    if (loading) return <div className={styles.loading}>Loading Rivalry Histories...</div>;
    if (!managersList.length) return <div className={styles.loading}>No manager data available.</div>;

    const metaA = managersList.find(m => m.managerId === managerA);
    const metaB = managersList.find(m => m.managerId === managerB);

    const totalGames = rivalryStats?.winsA + rivalryStats?.winsB + rivalryStats?.ties || 0;
    const winPctA = totalGames ? ((rivalryStats.winsA / totalGames) * 100).toFixed(0) : 50;
    const winPctB = totalGames ? ((rivalryStats.winsB / totalGames) * 100).toFixed(0) : 50;

    return (
        <div className={styles.container}>
            <h1 className={styles.headerTitle}>Head-to-Head Rivalry</h1>

            <div className={styles.selectorWrapper}>
                <div className={styles.teamSelector}>
                    <img src={metaA?.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp'} alt="Team A" className={styles.teamAvatar} />
                    <select 
                        className={styles.dropdown} 
                        value={managerA} 
                        onChange={(e) => setManagerA(e.target.value)}
                    >
                        {managersList.map(m => (
                            <option key={`a-${m.managerId}`} value={m.managerId} disabled={m.managerId === managerB}>
                                {m.teamName}
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.vsBadge}>VS</div>

                <div className={styles.teamSelector}>
                    <img src={metaB?.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp'} alt="Team B" className={styles.teamAvatar} />
                    <select 
                        className={styles.dropdown} 
                        value={managerB} 
                        onChange={(e) => setManagerB(e.target.value)}
                    >
                        {managersList.map(m => (
                            <option key={`b-${m.managerId}`} value={m.managerId} disabled={m.managerId === managerA}>
                                {m.teamName}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {totalGames === 0 ? (
                <div className={styles.emptyState}>
                    <h3>No Match History Found</h3>
                    <p>These two franchises have never faced each other.</p>
                </div>
            ) : (
                <div className={styles.contentGrid}>
                    <div className={styles.statsColumn}>
                        
                        <div className={styles.statCard}>
                            <h3 className={styles.cardHeader}>All-Time Series</h3>
                            <div className={styles.seriesRecord}>
                                <div className={styles.recordCol}>
                                    <span className={styles.recordLabel}>W</span>
                                    <div className={`${styles.recordSide} ${rivalryStats.winsA > rivalryStats.winsB ? styles.winner : ''}`}>
                                        {rivalryStats.winsA}
                                    </div>
                                </div>
                                <div className={styles.recordDivider}>-</div>
                                <div className={styles.recordCol}>
                                    <span className={styles.recordLabel}>L</span>
                                    <div className={`${styles.recordSide} ${rivalryStats.winsB > rivalryStats.winsA ? styles.winner : ''}`}>
                                        {rivalryStats.winsB}
                                    </div>
                                </div>
                                <div className={styles.recordDivider}>-</div>
                                <div className={styles.recordCol}>
                                    <span className={styles.recordLabel}>T</span>
                                    <div className={styles.recordSide} style={{ color: '#64748b' }}>
                                        {rivalryStats.ties}
                                    </div>
                                </div>
                            </div>
                            <div className={styles.barContainer}>
                                <div className={styles.barFillA} style={{ width: `${winPctA}%` }}></div>
                                <div className={styles.barFillB} style={{ width: `${winPctB}%` }}></div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <h3 className={styles.cardHeader}>Total Points Scored</h3>
                            <div className={styles.pointsCompare}>
                                <div className={`${styles.pointValue} ${rivalryStats.pointsA > rivalryStats.pointsB ? styles.goldText : ''}`}>
                                    {rivalryStats.pointsA.toFixed(2)}
                                </div>
                                <div className={styles.pointDivider}>to</div>
                                <div className={`${styles.pointValue} ${rivalryStats.pointsB > rivalryStats.pointsA ? styles.goldText : ''}`}>
                                    {rivalryStats.pointsB.toFixed(2)}
                                </div>
                            </div>
                        </div>

                        {rivalryStats.biggestBlowout && (
                            <div className={styles.statCard}>
                                <h3 className={styles.cardHeader}>Biggest Blowout</h3>
                                <div className={styles.highlightData}>
                                    <span className={styles.highlightDiff}>{rivalryStats.biggestBlowout.diff.toFixed(2)} pts</span>
                                    <span className={styles.highlightContext}>
                                        {rivalryStats.biggestBlowout.year} | Week {rivalryStats.biggestBlowout.week} ({rivalryStats.biggestBlowout.type})
                                    </span>
                                </div>
                            </div>
                        )}

                        {rivalryStats.closestMatch && (
                            <div className={styles.statCard}>
                                <h3 className={styles.cardHeader}>Closest Finish</h3>
                                <div className={styles.highlightData}>
                                    <span className={styles.highlightDiff}>{rivalryStats.closestMatch.diff.toFixed(2)} pts</span>
                                    <span className={styles.highlightContext}>
                                        {rivalryStats.closestMatch.year} | Week {rivalryStats.closestMatch.week} ({rivalryStats.closestMatch.type})
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={styles.historyColumn}>
                        <h3 className={styles.historyHeader}>Match History ({totalGames} Games)</h3>
                        <div className={styles.historyList}>
                            {rivalryStats.history.map((match, idx) => (
                                <div key={idx} className={styles.historyRow}>
                                    <div className={styles.historyMeta}>
                                        <span className={styles.hYear}>{match.year}</span>
                                        <span className={styles.hWeek}>Week {match.week}</span>
                                        <span className={styles.hType}>{match.type}</span>
                                    </div>

                                    <div className={styles.historyScores}>
                                        <div className={`${styles.hScoreBlock} ${match.scoreA > match.scoreB ? styles.winnerBlock : styles.loserBlock}`}>
                                            <img src={metaA.avatar} alt="A" className={styles.hAvatar} />
                                            <span className={styles.hScore}>{match.scoreA.toFixed(2)}</span>
                                        </div>
                                        
                                        <div className={styles.hScoreDivider}>vs</div>

                                        <div className={`${styles.hScoreBlock} ${match.scoreB > match.scoreA ? styles.winnerBlock : styles.loserBlock}`}>
                                            <span className={styles.hScore}>{match.scoreB.toFixed(2)}</span>
                                            <img src={metaB.avatar} alt="B" className={styles.hAvatar} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}