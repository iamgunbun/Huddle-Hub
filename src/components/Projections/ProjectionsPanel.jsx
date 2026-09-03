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
                
                const week = (nflState?.display_week && nflState.display_week > 0) ? nflState.display_week : 1;
                const playoffSpots = Number(currentLeagueData?.settings?.playoff_teams) || 6;
                
                let ranks = [];
                let totalPlayersFound = 0;
                
                for (const rosterID in rosters) {
                    const teamStats = standings[rosterID] || { wins: 0, losses: 0, ties: 0, fpts: 0 };
                    const teamMeta = getTeamFromTeamManagers(managersData, rosterID, currentLeagueData?.season || new Date().getFullYear());
                    const roster = rosters[rosterID];

                    let rosterStrength = 0;
                    if (roster && roster.players && roster.players.length > 0) {
                        totalPlayersFound += roster.players.length;
                        const rosterPlayers = roster.players.map(pId => playersInfo[pId]).filter(Boolean);
                        const rawStrength = predictScores(rosterPlayers, week, currentLeagueData);
                        rosterStrength = Number.isFinite(rawStrength) ? rawStrength : 0;
                    }

                    const wins = Number(teamStats.wins) || 0;
                    const losses = Number(teamStats.losses) || 0;
                    const ties = Number(teamStats.ties) || 0;
                    const fpts = Number(teamStats.fpts) || 0;
                    const weeksPlayed = wins + losses + ties;
                    
                    const progress = Math.min(weeksPlayed / 14, 1); 

                    const actualPPW = weeksPlayed > 0 ? (fpts / weeksPlayed) : rosterStrength;
                    const expectedPPW = (actualPPW * progress) + (rosterStrength * (1 - progress));

                    const actualWinPct = weeksPlayed > 0 ? ((wins + (ties * 0.5)) / weeksPlayed) : 0.5;
                    const expectedWinPct = (actualWinPct * progress) + (0.5 * (1 - progress));

                    const rawPowerScore = (expectedWinPct * 50) + expectedPPW;
                    const powerScore = Number.isFinite(rawPowerScore) ? rawPowerScore : 0;

                    ranks.push({
                        rosterID,
                        name: teamMeta?.name || 'Unknown Team',
                        avatar: teamMeta?.avatar,
                        wins,
                        losses,
                        powerScore
                    });
                }

                if (ranks.length === 0) {
                    setPowerRankings([]);
                    setPreDraftMode(false);
                    setLoading(false);
                    return;
                }

                // Only trigger pre-draft mode if no players exist on any roster at all
                const isPreDraft = totalPlayersFound === 0;
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
                    
                    const maxPower = ranks[0].powerScore || 1;
                    const kChamp = 0.08; 
                    const kPo = 0.05;

                    const champWeights = ranks.map(r => Math.exp(kChamp * (r.powerScore - maxPower)));
                    const poWeights = ranks.map(r => Math.exp(kPo * (r.powerScore - maxPower)));

                    const sumChampWeights = champWeights.reduce((a, b) => a + b, 0) || 1;
                    const sumPoWeights = poWeights.reduce((a, b) => a + b, 0) || 1;

                    finalRankings = ranks.map((team, index) => {
                        let champOdds = Math.round((champWeights[index] / sumChampWeights) * 100);
                        let poOdds = Math.round((poWeights[index] / sumPoWeights) * playoffSpots * 100);

                        champOdds = Math.max(0, Math.min(99, Number.isFinite(champOdds) ? champOdds : 0));
                        poOdds = Math.max(1, Math.min(99, Number.isFinite(poOdds) ? poOdds : 1)); 

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
                
                {activeLeague?.platform === 'yahoo' ? (
                    <div style={{ padding: '30px 20px', textAlign: 'center', margin: 0 }}>
                        <div style={{ 
                            background: 'rgba(238, 191, 28, 0.1)', 
                            border: '1px dashed rgba(238, 191, 28, 0.4)', 
                            borderRadius: '8px', 
                            padding: '16px',
                            display: 'inline-block',
                            marginBottom: '15px'
                        }}>
                            <i className="material-icons" style={{ fontSize: '32px', color: '#eebf1c' }}>science</i>
                        </div>
                        <h4 style={{ color: '#eebf1c', margin: '0 0 8px 0', fontSize: '1.1em' }}>Yahoo Projections Under Construction</h4>
                        <p style={{ color: '#94a3b8', fontSize: '0.9em', lineHeight: '1.6', margin: 0 }}>
                            We are actively mapping Yahoo's roster structures. Advanced playoff odds for Yahoo leagues will be available soon!
                        </p>
                    </div>
                ) : (
                    <p style={{ color: '#94a3b8', padding: '30px 20px', textAlign: 'center', margin: 0, fontStyle: 'italic', fontSize: '0.9em', lineHeight: '1.6' }}>
                        <i className="material-icons" style={{ display: 'block', fontSize: '32px', color: '#64748b', marginBottom: '10px' }}>layers_clear</i>
                        No roster configurations found.<br />Ensure franchise slots are created on Sleeper to launch projections.
                    </p>
                )}
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