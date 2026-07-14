import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getAwards, getLeagueTeamManagers, getLeagueRecords } from '../utils/helper';
import styles from './Awards.module.css';

export default function Awards() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    
    const [podiums, setPodiums] = useState([]);
    const [teamManagers, setTeamManagers] = useState(null);
    const [records, setRecords] = useState(null);
    const [selectedYear, setSelectedYear] = useState(null);

    useEffect(() => {
        const loadTrophyRoom = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [podiumsData, tmData, recordsData] = await Promise.all([
                    getAwards(true, activeLeague.sleeper_league_id),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    getLeagueRecords(true, activeLeague.sleeper_league_id)
                ]);

                // Sort podiums descending by year
                const sortedPodiums = (podiumsData || []).sort((a, b) => b.year - a.year);
                setPodiums(sortedPodiums);
                setTeamManagers(tmData);
                setRecords(recordsData);

                if (sortedPodiums.length > 0) {
                    setSelectedYear(sortedPodiums[0].year);
                }
            } catch (e) {
                console.error("Failed to load Trophy Room:", e);
            } finally {
                setLoading(false);
            }
        };
        loadTrophyRoom();
    }, [activeLeague]);

    const getTeamInfo = (rosterId, year) => {
        if (!teamManagers || !teamManagers.teamManagersMap) return { name: 'Unknown', avatar: 'https://sleepercdn.com/images/v2/icons/player_default.webp' };
        const yRosters = teamManagers.teamManagersMap[year] || teamManagers.teamManagersMap[teamManagers.currentSeason] || {};
        const roster = yRosters[rosterId];
        if (roster && roster.team) {
            return {
                name: roster.team.name,
                avatar: roster.team.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp',
                managerId: roster.managers?.[0]
            };
        }
        return { name: `Team ${rosterId}`, avatar: 'https://sleepercdn.com/images/v2/icons/player_default.webp' };
    };

    const getUserInfo = (managerId) => {
        if (!teamManagers || !teamManagers.users || !managerId) return { name: 'Unknown Manager', avatar: 'https://sleepercdn.com/images/v2/icons/player_default.webp' };
        const user = teamManagers.users[managerId];
        return {
            name: user.display_name || user.metadata?.team_name || 'Unknown',
            avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : 'https://sleepercdn.com/images/v2/icons/player_default.webp'
        };
    };

    const calculatedRecords = useMemo(() => {
        let hScore = { val: 0, text: '-', sub: '-' };
        let mChamps = { val: 0, text: '-', sub: '-' };
        let mWins = { val: 0, text: '-', sub: '-' };
        let mPoints = { val: 0, text: '-', sub: '-' };
        let mLosses = { val: 0, text: '-', sub: '-' };

        if (records?.regularSeasonData) {
            const rData = records.regularSeasonData;
            
            // Highest Score Ever
            if (rData.leagueWeekHighs?.length > 0) {
                const sortedHighs = [...rData.leagueWeekHighs].sort((a, b) => b.fpts - a.fpts);
                const h = sortedHighs[0];
                const isTied = sortedHighs.length > 1 && sortedHighs[1].fpts === h.fpts;
                const t = getTeamInfo(h.rosterID, h.year);
                hScore = { val: `${h.fpts.toFixed(2)}${isTied ? 'T' : ''}`, text: t.name, sub: `${h.year} Wk ${h.week}` };
            }

            // Most Championships (With Recency Tie-Breaker Logic)
            let mCount = {};
            podiums.forEach(p => {
                const t = getTeamInfo(p.champion, p.year);
                if (t.managerId) {
                    if (!mCount[t.managerId]) mCount[t.managerId] = { count: 0, mostRecent: p.year };
                    mCount[t.managerId].count += 1;
                    if (p.year > mCount[t.managerId].mostRecent) mCount[t.managerId].mostRecent = p.year;
                }
            });
            const sortedChamps = Object.entries(mCount).sort((a, b) => {
                if (b[1].count !== a[1].count) return b[1].count - a[1].count;
                return b[1].mostRecent - a[1].mostRecent; // Break ties by most recent year
            });
            
            if (sortedChamps.length > 0) {
                const topCount = sortedChamps[0][1].count;
                const isTied = sortedChamps.length > 1 && sortedChamps[1][1].count === topCount;
                mChamps = { 
                    val: `${topCount}${isTied ? 'T' : ''}`, 
                    text: getUserInfo(sortedChamps[0][0]).name, 
                    sub: 'All-Time' 
                };
            }

            // Aggregate Lifetime Records
            if (rData.leagueManagerRecords) {
                const mgrs = Object.entries(rData.leagueManagerRecords);
                
                // Most Wins
                const sortedWins = [...mgrs].sort((a,b) => b[1].wins - a[1].wins);
                if (sortedWins.length > 0) {
                    const topWins = sortedWins[0][1].wins;
                    const isTied = sortedWins.length > 1 && sortedWins[1][1].wins === topWins;
                    mWins = { val: `${topWins}${isTied ? 'T' : ''}`, text: getUserInfo(sortedWins[0][0]).name, sub: 'Wins' };
                }

                // Most Points
                const sortedPts = [...mgrs].sort((a,b) => b[1].fptsFor - a[1].fptsFor);
                if (sortedPts.length > 0) {
                    const topPts = sortedPts[0][1].fptsFor;
                    const isTied = sortedPts.length > 1 && sortedPts[1][1].fptsFor === topPts;
                    mPoints = { val: `${topPts.toFixed(2)}${isTied ? 'T' : ''}`, text: getUserInfo(sortedPts[0][0]).name, sub: 'Points' };
                }

                // Most Losses
                const sortedLosses = [...mgrs].sort((a,b) => b[1].losses - a[1].losses);
                if (sortedLosses.length > 0) {
                    const topLosses = sortedLosses[0][1].losses;
                    const isTied = sortedLosses.length > 1 && sortedLosses[1][1].losses === topLosses;
                    mLosses = { val: `${topLosses}${isTied ? 'T' : ''}`, text: getUserInfo(sortedLosses[0][0]).name, sub: 'Losses' };
                }
            }
        }
        return { hScore, mChamps, mWins, mPoints, mLosses };
    }, [records, podiums, teamManagers]);

    if (loading) return <div className={styles.loading}>Opening Trophy Room...</div>;
    if (podiums.length === 0) return <div className={styles.loading}>No Historical Data Found.</div>;

    const activePodium = podiums.find(p => p.year === selectedYear) || podiums[0];

    const p1 = getTeamInfo(activePodium.champion, activePodium.year);
    const p2 = getTeamInfo(activePodium.second, activePodium.year);
    const p3 = getTeamInfo(activePodium.third, activePodium.year);

    return (
        <div className={styles.container}>
            {/* --- HALL OF CHAMPIONS --- */}
            <div className={styles.heroSection}>
                <h1 className={styles.mainTitle}>🏆 Hall of Champions</h1>
                <div className={styles.heroTrophy}>
                    <i className="material-icons" style={{ fontSize: '80px', color: '#eebf1c', textShadow: '0 0 30px rgba(238, 191, 28, 0.6)' }}>emoji_events</i>
                </div>
                
                <div className={styles.champGrid}>
                    {podiums.map((p, idx) => {
                        const champTeam = getTeamInfo(p.champion, p.year);
                        const isReigning = idx === 0;
                        
                        return (
                            <div key={`champ-${p.year}`} className={`${styles.champCard} ${isReigning ? styles.latestChamp : ''}`}>
                                <h2 className={styles.heroYear}>{p.year} {isReigning ? 'Champ' : ''}</h2>
                                <img src={champTeam.avatar} alt="Champ" className={styles.heroAvatar} />
                                <div className={styles.heroName}>{champTeam.name}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className={styles.divider} />

            {/* --- CHAMPIONS WING --- */}
            <div className={styles.wingSection}>
                <h2 className={styles.wingTitle}>👑 Champions Wing</h2>
                
                <div className={styles.yearTabs}>
                    {podiums.map(p => (
                        <button 
                            key={p.year} 
                            className={`${styles.yearTab} ${selectedYear === p.year ? styles.activeTab : ''}`}
                            onClick={() => setSelectedYear(p.year)}
                        >
                            {p.year}
                        </button>
                    ))}
                </div>

                <div className={styles.podiumContainer}>
                    {/* 2nd Place */}
                    <div className={`${styles.podiumBlock} ${styles.secondPlace}`}>
                        <img src={p2.avatar} alt="2nd" className={styles.podiumAvatar} />
                        <div className={styles.podiumName}>{p2.name}</div>
                        <div className={styles.podiumPedestal}>
                            <span className={styles.medal}>🥈</span>
                            <span className={styles.placeText}>Runner-Up</span>
                        </div>
                    </div>
                    
                    {/* 1st Place */}
                    <div className={`${styles.podiumBlock} ${styles.firstPlace}`}>
                        <img src={p1.avatar} alt="1st" className={styles.podiumAvatar} />
                        <div className={styles.podiumName}>{p1.name}</div>
                        <div className={styles.podiumPedestal}>
                            <span className={styles.medal}>🥇</span>
                            <span className={styles.placeText}>Champion</span>
                        </div>
                    </div>

                    {/* 3rd Place */}
                    <div className={`${styles.podiumBlock} ${styles.thirdPlace}`}>
                        <img src={p3.avatar} alt="3rd" className={styles.podiumAvatar} />
                        <div className={styles.podiumName}>{p3.name}</div>
                        <div className={styles.podiumPedestal}>
                            <span className={styles.medal}>🥉</span>
                            <span className={styles.placeText}>Third Place</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className={styles.divider} />

            {/* --- HALL OF SHAME --- */}
            <div className={styles.shameSection}>
                <h2 className={styles.wingTitle} style={{ color: '#94a3b8' }}>💩 Hall of Shame</h2>
                <h3 className={styles.shameSubtitle}>🚽 Toilet Bowl Losers</h3>
                
                <div className={styles.shameGrid}>
                    {podiums.map(p => {
                        const toiletTeam = getTeamInfo(p.toilet, p.year);
                        if (!p.toilet) return null;
                        return (
                            <div key={`shame-${p.year}`} className={styles.shameCard}>
                                <div className={styles.shameYear}>{p.year}</div>
                                <img src={toiletTeam.avatar} alt="Loser" className={styles.shameAvatar} />
                                <div className={styles.shameName}>{toiletTeam.name}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className={styles.divider} />

            {/* --- LEAGUE RECORDS --- */}
            <div className={styles.recordsSection}>
                <h2 className={styles.wingTitle}>📜 League Records</h2>
                
                <div className={styles.recordsGrid}>
                    <div className={styles.recordCard}>
                        <div className={styles.recordTitle}>Highest Score Ever</div>
                        <div className={styles.recordValue}>{calculatedRecords.hScore.val}</div>
                        <div className={styles.recordHolder}>{calculatedRecords.hScore.text}</div>
                        <div className={styles.recordSub}>{calculatedRecords.hScore.sub}</div>
                    </div>

                    <div className={styles.recordCard}>
                        <div className={styles.recordTitle}>Most Championships</div>
                        <div className={styles.recordValue}>{calculatedRecords.mChamps.val}</div>
                        <div className={styles.recordHolder}>{calculatedRecords.mChamps.text}</div>
                        <div className={styles.recordSub}>{calculatedRecords.mChamps.sub}</div>
                    </div>

                    <div className={styles.recordCard}>
                        <div className={styles.recordTitle}>Most All-Time Wins</div>
                        <div className={styles.recordValue}>{calculatedRecords.mWins.val}</div>
                        <div className={styles.recordHolder}>{calculatedRecords.mWins.text}</div>
                        <div className={styles.recordSub}>{calculatedRecords.mWins.sub}</div>
                    </div>

                    <div className={styles.recordCard}>
                        <div className={styles.recordTitle}>Most Points Scored</div>
                        <div className={styles.recordValue}>{calculatedRecords.mPoints.val}</div>
                        <div className={styles.recordHolder}>{calculatedRecords.mPoints.text}</div>
                        <div className={styles.recordSub}>{calculatedRecords.mPoints.sub}</div>
                    </div>

                    <div className={styles.recordCard}>
                        <div className={styles.recordTitle}>Most Losses</div>
                        <div className={styles.recordValue}>{calculatedRecords.mLosses.val}</div>
                        <div className={styles.recordHolder}>{calculatedRecords.mLosses.text}</div>
                        <div className={styles.recordSub}>{calculatedRecords.mLosses.sub}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}