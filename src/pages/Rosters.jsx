import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueRosters, getLeagueTeamManagers, loadPlayers, getLeagueData, getLeagueStandings } from '../utils/helper';
import { getTeamFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import styles from './Rosters.module.css';

export default function Rosters() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [rosters, setRosters] = useState({});
    const [teamManagers, setTeamManagers] = useState(null);
    const [playersInfo, setPlayersInfo] = useState({});
    const [leagueData, setLeagueData] = useState(null);
    const [standings, setStandings] = useState(null);
    const [viewMode, setViewMode] = useState('mine');
    const [myRosterId, setMyRosterId] = useState(null);
    const [selectingTeam, setSelectingTeam] = useState(false);
    const [expandedBenches, setExpandedBenches] = useState({});

    // Strips all casing, spaces, and special characters for a perfect comparison
    const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const sleeperId = activeLeague.sleeper_league_id;
                const [rData, tmData, pData, lData, sData] = await Promise.all([
                    getLeagueRosters(sleeperId),
                    getLeagueTeamManagers(sleeperId),
                    loadPlayers(),
                    getLeagueData(sleeperId),
                    getLeagueStandings(sleeperId)
                ]);

                if (!isMounted) return;
                
                setRosters(rData.rosters || {});
                setTeamManagers(tmData);
                setPlayersInfo(pData.players || {});
                setLeagueData(lData);
                setStandings(sData?.standingsInfo || {});
                
                const { data: sessionData } = await supabase.auth.getSession();
                const user = sessionData?.session?.user;

                if (user && activeLeague?.id) {
                    const { data: ulData } = await supabase
                        .from('user_leagues')
                        .select('team_name')
                        .eq('user_id', user.id)
                        .eq('league_id', activeLeague.id)
                        .single();

                    const searchName = normalizeStr(ulData?.team_name);

                    if (searchName && searchName !== normalizeStr('commissioner team')) {
                        const currentSeason = tmData.currentSeason;
                        const rostersMap = tmData.teamManagersMap[currentSeason] || {};
                        let foundRosterId = null;

                        for (const [rId, rData] of Object.entries(rostersMap)) {
                            if (normalizeStr(rData.team?.name) === searchName) {
                                foundRosterId = rId;
                                break;
                            }
                        }

                        if (foundRosterId) setMyRosterId(foundRosterId);
                        else setViewMode('all'); 
                    } else {
                        setViewMode('all');
                    }
                }
            } catch (e) {
                console.error("Failed to load rosters:", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    const handleSetMyTeam = async (e) => {
        const id = e.target.value;
        if (!id) return;
        
        setMyRosterId(id);
        const selectedTeamName = teamManagers.teamManagersMap[teamManagers.currentSeason][id].team.name;
        
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
            await supabase.from('user_leagues')
                .update({ team_name: selectedTeamName })
                .eq('user_id', sessionData.session.user.id)
                .eq('league_id', activeLeague.id);
        }
        setSelectingTeam(false);
    };

    const toggleBench = (rosterId) => {
        setExpandedBenches(prev => ({
            ...prev,
            [rosterId]: !prev[rosterId]
        }));
    };

    if (loading) return <div className={styles.loading}>Loading Teams...</div>;
    if (!leagueData || !teamManagers || Object.keys(rosters).length === 0) {
        return <div className={styles.loading}>No roster data available for this league.</div>;
    }

    const currentSeason = teamManagers.currentSeason;
    const rosterPositions = leagueData.roster_positions || [];

    const getAvatar = (playerId, playerMeta) => {
        if (!playerMeta) return 'https://sleepercdn.com/images/v2/icons/player_default.webp';
        if (playerMeta.pos === 'DEF') return `https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png`;
        return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;
    };

    const getPositionStyle = (cleanPos) => {
        const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'BN', 'IR', 'TAXI'];
        const basePos = validPositions.includes(cleanPos) ? cleanPos : 'BN';
        return {
            backgroundColor: `var(--${basePos})`,
            color: '#0b0e14',
            fontWeight: '800'
        };
    };

    const renderPlayerRow = (playerId, positionLabel) => {
        const player = playersInfo[playerId];
        const isPlaceholder = playerId === "0" || !player;
        
        return (
            <div key={playerId + positionLabel + Math.random()} className={styles.playerRow}>
                <div className={styles.posBadge} style={getPositionStyle(positionLabel.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX'))}>
                    {positionLabel.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX')}
                </div>
                
                {isPlaceholder ? (
                    <div className={styles.playerInfoGroup}>
                        <div className={styles.playerImg} style={{ backgroundImage: `url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}></div>
                        <div className={styles.playerText}>
                            <span className={styles.pName}>Empty Slot</span>
                        </div>
                    </div>
                ) : (
                    <div className={styles.playerInfoGroup}>
                        <div className={styles.playerImg} style={{ backgroundImage: `url(${getAvatar(playerId, player)}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}></div>
                        <div className={styles.playerText}>
                            <span className={styles.pName}>{player.fn} {player.ln}</span>
                            <span className={styles.pMeta}>{player.pos} - {player.t}</span>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderRosterCard = (rosterId, isConsolidated) => {
        const roster = rosters[rosterId];
        if (!roster) return null;

        const teamMeta = getTeamFromTeamManagers(teamManagers, rosterId, currentSeason);
        const teamStandings = standings[rosterId] || { wins: 0, losses: 0, ties: 0, fpts: 0 };
        
        const starters = roster.starters || [];
        const allPlayers = roster.players || [];
        const reserve = roster.reserve || [];
        const taxi = roster.taxi || [];
        const bench = allPlayers.filter(p => !starters.includes(p) && !reserve.includes(p) && !taxi.includes(p));

        const isExpanded = expandedBenches[rosterId];

        return (
            <div key={rosterId} className={styles.rosterCard}>
                <div className={styles.teamHeader}>
                    <img src={teamMeta.avatar} alt="Avatar" className={styles.teamAvatar} />
                    <div className={styles.teamDetails}>
                        <h3 className={styles.teamName}>{teamMeta.name}</h3>
                        <div className={styles.teamStats}>
                            Record: {teamStandings.wins}-{teamStandings.losses}{teamStandings.ties > 0 ? `-${teamStandings.ties}` : ''} | PF: {parseFloat(teamStandings.fpts).toFixed(2)}
                        </div>
                    </div>
                </div>

                <div className={isConsolidated ? styles.rosterGridConsolidated : styles.rosterGrid}>
                    <div className={styles.rosterColumn}>
                        <h4 className={styles.sectionTitle}>Starting Lineup</h4>
                        <div className={styles.playerList}>
                            {starters.map((pId, idx) => renderPlayerRow(pId, rosterPositions[idx] || 'BN'))}
                        </div>
                    </div>

                    {isConsolidated ? (
                        <>
                            <button className={styles.toggleBenchBtn} onClick={() => toggleBench(rosterId)}>
                                {isExpanded ? 'Hide Bench' : 'Show Bench'}
                            </button>
                            
                            {isExpanded && (
                                <div className={styles.rosterColumn}>
                                    <h4 className={styles.sectionTitle}>Bench</h4>
                                    <div className={styles.playerList}>{bench.map(pId => renderPlayerRow(pId, 'BN'))}</div>
                                    {reserve.length > 0 && (
                                        <>
                                            <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Injured Reserve</h4>
                                            <div className={styles.playerList}>{reserve.map(pId => renderPlayerRow(pId, 'IR'))}</div>
                                        </>
                                    )}
                                    {taxi.length > 0 && (
                                        <>
                                            <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Taxi Squad</h4>
                                            <div className={styles.playerList}>{taxi.map(pId => renderPlayerRow(pId, 'TAXI'))}</div>
                                        </>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className={styles.rosterColumn}>
                            <h4 className={styles.sectionTitle}>Bench</h4>
                            <div className={styles.playerList}>{bench.map(pId => renderPlayerRow(pId, 'BN'))}</div>
                            {reserve.length > 0 && (
                                <>
                                    <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Injured Reserve</h4>
                                    <div className={styles.playerList}>{reserve.map(pId => renderPlayerRow(pId, 'IR'))}</div>
                                </>
                            )}
                            {taxi.length > 0 && (
                                <>
                                    <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Taxi Squad</h4>
                                    <div className={styles.playerList}>{taxi.map(pId => renderPlayerRow(pId, 'TAXI'))}</div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className={styles.container}>
            <div className={styles.viewToggles}>
                <button className={`${styles.toggleBtn} ${viewMode === 'mine' ? styles.active : ''}`} onClick={() => setViewMode('mine')}>
                    My Team
                </button>
                <button className={`${styles.toggleBtn} ${viewMode === 'all' ? styles.active : ''}`} onClick={() => setViewMode('all')}>
                    All Teams
                </button>
            </div>

            {viewMode === 'mine' ? (
                (!myRosterId || selectingTeam) ? (
                    <div className={styles.claimBox}>
                        <h3 style={{ color: '#f8fafc', marginTop: 0 }}>Which team is yours?</h3>
                        <p style={{ color: '#94a3b8', fontSize: '0.9em' }}>Select your team to view your roster.</p>
                        <select onChange={handleSetMyTeam} defaultValue="">
                            <option value="" disabled>-- Select Your Team --</option>
                            {Object.entries(teamManagers.teamManagersMap[currentSeason] || {}).map(([rId, rData]) => (
                                <option key={rId} value={rId}>{rData.team.name}</option>
                            ))}
                        </select>
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                            <button 
                                style={{ background: 'transparent', border: 'none', color: '#64748b', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.85em' }} 
                                onClick={() => setSelectingTeam(true)}
                            >
                                Wrong Team? Change it here.
                            </button>
                        </div>
                        {renderRosterCard(myRosterId, false)}
                    </>
                )
            ) : (
                <div className={styles.allTeamsGrid}>
                    {Object.keys(rosters).map(rId => renderRosterCard(rId, true))}
                </div>
            )}
        </div>
    );
}