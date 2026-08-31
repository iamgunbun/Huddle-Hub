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
                    
                    // Ratio to blend baseline projections vs actual season performance (maxes at 1 after 14 weeks)
                    const progress = Math.min(weeksPlayed / 14, 1); 

                    // Blend points per week
                    const actualPPW = weeksPlayed > 0 ? (teamStats.fpts / weeksPlayed) : rosterStrength;
                    const expectedPPW = (actualPPW * progress) + (rosterStrength * (1 - progress));

                    // Blend win percentage (Assume 0.500 if no games played)
                    const actualWinPct = weeksPlayed > 0 ? ((teamStats.wins + (teamStats.ties * 0.5)) / weeksPlayed) : 0.5;
                    const expectedWinPct = (actualWinPct * progress) + (0.5 * (1 - progress));

                    // Dynamic Power Score
                    const powerScore = (expectedWinPct * 50) + expectedPPW;

                    ranks.push({
                        rosterID,
                        name: teamMeta.name || 'Unknown Team',
                        avatar: teamMeta.avatar,
                        wins: teamStats.wins,
                        losses: teamStats.losses,
                        powerScore
                    });
                }

                if (ranks.length === 0) {
                    setPowerRankings([]);
                    setPreDraftMode(false);
                    setLoading(false);
                    return;
                }

                const isPreDraft = ranks.every(t => t.powerScore === 0);
                setPreDraftMode(isPreDraft);

                let finalRankings = [];

                if (isPreDraft) {
                    finalRankings = ranks.map((team) => {
                        const po = Math.round((playoffSpots / ranks.length) * 100);
                        const champ = Math.round((1 / ranks.length) * 100);
                        return { ...team, po, champ };
                    });
                } else {
                    ranks.sort((a, b) => b.powerScore - a.powerScore);
                    
                    const maxPower = ranks[0].powerScore;
                    
                    // Softmax sensitivity tuning multipliers
                    const kChamp = 0.08; 
                    const kPo = 0.05;

                    // Calculate exponential weights for mathematical distribution
                    const champWeights = ranks.map(r => Math.exp(kChamp * (r.powerScore - maxPower)));
                    const poWeights = ranks.map(r => Math.exp(kPo * (r.powerScore - maxPower)));

                    const sumChampWeights = champWeights.reduce((a, b) => a + b, 0);
                    const sumPoWeights = poWeights.reduce((a, b) => a + b, 0);

                    finalRankings = ranks.map((team, index) => {
                        // Distribute exactly 100% for Champ, and exactly (playoffSpots * 100)% for Playoffs
                        let champOdds = Math.round((champWeights[index] / sumChampWeights) * 100);
                        let poOdds = Math.round((poWeights[index] / sumPoWeights) * playoffSpots * 100);

                        // Bound the odds appropriately
                        champOdds = Math.max(0, Math.min(99, champOdds));
                        poOdds = Math.max(1, Math.min(99, poOdds)); 

                        return { ...team, po: poOdds, champ: champOdds };
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
                        {preDraftMode ? '-' : (i + 1)} 
                    </div>
                    <img src={team.avatar} alt="Avatar" className={styles.avatar} onError={(e) => e.target.src = 'https://sleepercdn.com/images/v2/icons/league_default.webp'} />
                    
                    {/* Added minWidth: 0 to flex container to allow truncation child to work */}
                    <div className={styles.teamInfo} style={{ flex: 1, minWidth: 0, paddingRight: '10px' }}>
                        {/* Added block, nowrap, overflow, and ellipsis rules */}
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