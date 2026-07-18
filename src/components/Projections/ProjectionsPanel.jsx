import React, { useState, useEffect } from 'react';
import { useLeague } from '../../context/LeagueContext';
import { getLeagueStandings, getLeagueRosters, getLeagueTeamManagers, getLeagueData, loadPlayers, getNflState, predictScores } from '../../utils/helper';
import { getTeamFromTeamManagers } from '../../utils/helperFunctions/universalFunctions';
import styles from './Projections.module.css';

export default function ProjectionsPanel() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [powerRankings, setPowerRankings] = useState([]);
    const [preDraftMode, setPreDraftMode] = useState(false);

    useEffect(() => {
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            
            try {
                const id = activeLeague.sleeper_league_id;
                const [standingsData, rostersData, managersData, currentLeagueData, pData, nflState] = await Promise.all([
                    getLeagueStandings(id),
                    getLeagueRosters(id),
                    getLeagueTeamManagers(id),
                    getLeagueData(id),
                    loadPlayers(),
                    getNflState()
                ]);

                const standings = standingsData?.standingsInfo || {};
                const rosters = rostersData?.rosters || {};
                const playersInfo = pData?.players || {};
                
                const week = nflState?.display_week > 0 ? nflState.display_week : 1;
                const playoffSpots = currentLeagueData?.settings?.playoff_teams || 6;
                
                let ranks = [];
                
                for (const rosterID in rosters) {
                    const teamStats = standings[rosterID] || { wins: 0, losses: 0, ties: 0, fpts: 0 };
                    const teamMeta = getTeamFromTeamManagers(managersData, rosterID, currentLeagueData.season);
                    const roster = rosters[rosterID];

                    let rosterStrength = 0;
                    if (roster && roster.players && roster.players.length > 0) {
                        const rosterPlayers = roster.players.map(pId => playersInfo[pId]).filter(p => p);
                        rosterStrength = predictScores(rosterPlayers, week, currentLeagueData);
                    }

                    const weeksPlayed = teamStats.wins + teamStats.losses + teamStats.ties;
                    const pointsPerWeek = weeksPlayed > 0 ? (teamStats.fpts / weeksPlayed) : rosterStrength;
                    
                    const powerScore = (teamStats.wins * 25) + pointsPerWeek + (rosterStrength * 2);

                    ranks.push({
                        rosterID,
                        name: teamMeta.name || 'Unknown Team',
                        avatar: teamMeta.avatar,
                        wins: teamStats.wins,
                        losses: teamStats.losses,
                        powerScore
                    });
                }

                // Hard Gatekeeper: If no rosters exist yet at all, exit out early to prevent NaN crash
                if (ranks.length === 0) {
                    setPowerRankings([]);
                    setPreDraftMode(false);
                    setLoading(false);
                    return;
                }

                // Check if this is a pre-draft league (all power scores are exactly 0)
                const isPreDraft = ranks.every(t => t.powerScore === 0);
                setPreDraftMode(isPreDraft);

                let finalRankings = [];

                if (isPreDraft) {
                    // Distribute perfect, even baseline probability percentages across all slots
                    finalRankings = ranks.map((team) => {
                        const po = Math.round((playoffSpots / ranks.length) * 100);
                        const champ = Math.round((1 / ranks.length) * 100);
                        return { ...team, po, champ };
                    });
                } else {
                    // Standard Deviation Bell Curve Matrix for active leagues
                    ranks.sort((a, b) => b.powerScore - a.powerScore);
                    
                    const avgPower = ranks.reduce((sum, r) => sum + r.powerScore, 0) / ranks.length;
                    const variance = ranks.reduce((sum, r) => sum + Math.pow(r.powerScore - avgPower, 2), 0) / ranks.length;
                    const stdDev = Math.sqrt(variance) || 1; 

                    finalRankings = ranks.map((team) => {
                        const zScore = (team.powerScore - avgPower) / stdDev;
                        const playoffSpotShift = (playoffSpots - (ranks.length / 2)) * 0.4;
                        
                        const poOdds = Math.round(100 / (1 + Math.exp(-(zScore * 1.6 + playoffSpotShift))));
                        const po = Math.max(1, Math.min(99, poOdds)); 

                        const champOdds = Math.round(100 / (1 + Math.exp(-(zScore * 2.2 - 1.8))));
                        const champ = Math.max(0, Math.min(99, champOdds));

                        return { ...team, po, champ };
                    });
                }

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
        return <div className={styles.card}><p style={{ color: '#94a3b8', padding: '20px', textAlign: 'center', margin: 0, fontStyle: 'italic' }}>Simulating Matchups...</p></div>;
    }

    // TRUE EMPTY STATE: If no teams or rosters are found in the system
    if (powerRankings.length === 0) {
        return (
            <div className={styles.card}>
                <h3 style={{ textAlign: 'center', fontSize: '1.3em', fontWeight: '500', color: '#f8fafc', padding: '15px 0', margin: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    Live Projections
                </h3>
                <p style={{ color: '#94a3b8', padding: '30px 20px', textAlign: 'center', margin: 0, fontStyle: 'italic', fontSize: '0.9em', lineHeight: '1.6' }}>
                    <i className="material-icons" style={{ display: 'block', fontSize: '32px', color: '#64748b', marginBottom: '10px' }}>layers_clear</i>
                    No roster configurations found.<br />Ensure franchise slots are created on Sleeper to launch projections.
                </p>
            </div>
        );
    }

    return (
        <div className={styles.card}>
            <div style={{ padding: '15px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'center' }}>
                <h3 style={{ fontSize: '1.3em', fontWeight: '500', color: '#f8fafc', margin: 0 }}>Live Projections</h3>
                {preDraftMode && (
                    <span style={{ color: '#eebf1c', fontSize: '0.7em', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginTop: '4px' }}>
                        <i className="material-icons" style={{ fontSize: '10px', verticalAlign: 'middle', marginRight: '4px' }}>auto_awesome</i>
                        Pre-Draft Uniform Baseline
                    </span>
                )}
            </div>
            
            {powerRankings.map((team, i) => (
                <div key={team.rosterID} className={styles.teamRow}>
                    <div className={styles.rankBadge}>
                        {preDraftMode ? '-' : (i === 0 ? '-' : i === powerRankings.length - 1 ? '-1' : '-')} 
                    </div>
                    <img src={team.avatar} alt="Avatar" className={styles.avatar} onError={(e) => e.target.src = 'https://sleepercdn.com/images/v2/icons/league_default.webp'} />
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