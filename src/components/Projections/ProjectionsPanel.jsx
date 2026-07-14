import React, { useState, useEffect } from 'react';
import { useLeague } from '../../context/LeagueContext';
import { getLeagueStandings, getLeagueRosters, getLeagueTeamManagers, getLeagueData } from '../../utils/helper';
import { getTeamFromTeamManagers } from '../../utils/helperFunctions/universalFunctions';
import styles from './Projections.module.css';

export default function ProjectionsPanel() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [powerRankings, setPowerRankings] = useState([]);

    useEffect(() => {
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            
            try {
                // Pass the specific ID to bypass any Svelte store dependencies
                const id = activeLeague.sleeper_league_id;
                const [standingsData, rostersData, managersData, currentLeagueData] = await Promise.all([
                    getLeagueStandings(id),
                    getLeagueRosters(id),
                    getLeagueTeamManagers(id),
                    getLeagueData(id)
                ]);

                const standings = standingsData?.standingsInfo || {};
                const rosters = rostersData?.rosters || {};
                
                // Calculate analytical baselines based on current performance
                let ranks = [];
                for (const rosterID in rosters) {
                    const teamStats = standings[rosterID] || { wins: 0, losses: 0, ties: 0, fpts: 0 };
                    const teamMeta = getTeamFromTeamManagers(managersData, rosterID, currentLeagueData.season);
                    
                    ranks.push({
                        rosterID,
                        name: teamMeta.name || 'Unknown Team',
                        avatar: teamMeta.avatar,
                        wins: teamStats.wins,
                        losses: teamStats.losses,
                        // Weighting formula to rank teams
                        baseScore: (teamStats.wins * 50) + parseFloat(teamStats.fpts)
                    });
                }

                ranks.sort((a, b) => b.baseScore - a.baseScore);
                
                // Assign odds mathematically based on rank distribution
                const finalRankings = ranks.map((team, index) => {
                    const po = Math.max(10, 92 - (index * 8)); 
                    const champ = Math.max(1, 28 - (index * 4));
                    return { ...team, po, champ };
                });

                setPowerRankings(finalRankings);
            } catch (e) {
                console.error("Projections Error:", e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [activeLeague]);

    if (loading) {
        return <div className={styles.card}><p style={{ color: '#94a3b8', padding: '20px' }}>Syncing Data...</p></div>;
    }

    return (
        <div className={styles.card}>
            <h3 style={{ textAlign: 'center', fontSize: '1.3em', fontWeight: '500', color: '#f8fafc', padding: '15px 0', margin: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Live Projections</h3>
            {powerRankings.map((team, i) => (
                <div key={team.rosterID} className={styles.teamRow}>
                    <div className={styles.rankBadge}>
                        {i === 0 ? '-' : i === powerRankings.length - 1 ? '-1' : '-'} 
                    </div>
                    <img src={team.avatar} alt="Avatar" className={styles.avatar} />
                    <div className={styles.teamInfo}>
                        <span className={styles.teamName}>{team.name}</span>
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