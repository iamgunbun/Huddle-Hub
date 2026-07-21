import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueRosters, getLeagueTeamManagers, loadPlayers, getLeagueData, getLeagueStandings } from '../utils/helper';
import { getTeamFromTeamManagers, formatOpponent } from '../utils/helperFunctions/universalFunctions';
import PlayerModal from '../components/PlayerModal';
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
    
    const [expandedBenches, setExpandedBenches] = useState({});
    const [expandedTeams, setExpandedTeams] = useState({});
    
    const [activeWeek, setActiveWeek] = useState(1);
    const [weeklyMatchups, setWeeklyMatchups] = useState([]);
    const [weeklyProjections, setWeeklyProjections] = useState({});
    const [nflScheduleMap, setNflScheduleMap] = useState({});
    
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const normalizeTeam = (t) => {
        if (!t) return '';
        const map = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', NOH: 'NO' };
        const upper = String(t).toUpperCase();
        return map[upper] || upper;
    };

    const getPlayerObj = (pId) => {
        if (!pId || pId === "0") return null;
        return playersInfo[pId] || playersInfo[String(pId)] || playersInfo[Number(pId)] || null;
    };

    // 1. Initial Load
    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [rData, tmData, pData, lData, sData] = await Promise.all([
                    getLeagueRosters(activeLeague.sleeper_league_id),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    loadPlayers(),
                    getLeagueData(activeLeague.sleeper_league_id),
                    getLeagueStandings(activeLeague.sleeper_league_id)
                ]);
                if (!isMounted) return;
                                 
                setRosters(rData.rosters || {});
                setTeamManagers(tmData);
                setPlayersInfo(pData.players || {});
                setLeagueData(lData);
                setStandings(sData?.standingsInfo || {});
                
                if (lData?.display_week) setActiveWeek(lData.display_week);
                                 
                const { data: sessionData } = await supabase.auth.getSession();
                if (sessionData?.session?.user && activeLeague?.id) {
                    const { data: ulData } = await supabase.from('user_leagues').select('team_name').eq('user_id', sessionData.session.user.id).eq('league_id', activeLeague.id).single();
                    const searchName = normalizeStr(ulData?.team_name);
                    
                    if (searchName && searchName !== normalizeStr('commissioner team')) {
                        const rostersMap = tmData.teamManagersMap[tmData.currentSeason] || {};
                        let foundRosterId = Object.keys(rostersMap).find(rId => normalizeStr(rostersMap[rId].team?.name) === searchName);
                        if (foundRosterId) setMyRosterId(foundRosterId);
                        else setViewMode('all'); 
                    } else setViewMode('all');
                }
            } catch (e) { console.error(e); } finally { if (isMounted) setLoading(false); }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    // 2. Weekly Projections and Matchups
    useEffect(() => {
        const season = leagueData?.season || new Date().getFullYear();
        if (!activeLeague?.sleeper_league_id) return;
        let isMounted = true;

        fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}/matchups/${activeWeek}`)
            .then(res => res.json())
            .then(data => { if (isMounted) setWeeklyMatchups(data || []); })
            .catch(err => console.error("Matchups fetch err:", err));

        fetch(`https://api.sleeper.app/v1/projections/nfl/regular/${season}/${activeWeek}`)
            .then(res => res.json())
            .then(data => { if (isMounted) setWeeklyProjections(data || {}); })
            .catch(err => console.error("Projections fetch err:", err));

        // FIX: Safe Weekly Schedule Request
        fetch(`https://api.sleeper.app/v1/schedule/nfl/regular/${season}/${activeWeek}`)
            .then(res => res.json())
            .then(sData => {
                if (isMounted && Array.isArray(sData)) {
                    const map = {};
                    sData.forEach(game => {
                        const homeTeam = game.home_team || game.home;
                        const awayTeam = game.away_team || game.away;
                        if (homeTeam && awayTeam) {
                            const home = normalizeTeam(homeTeam);
                            const away = normalizeTeam(awayTeam);
                            map[home] = `VS ${away}`;
                            map[away] = `@${home}`;
                        }
                    });
                    setNflScheduleMap(map);
                }
            })
            .catch(err => console.error("Schedule fetch err:", err));

        return () => { isMounted = false; };
    }, [activeLeague, activeWeek, leagueData?.season]);

    const handleToggleView = () => {
        if (viewMode === 'mine') {
            setViewMode('all');
            setExpandedTeams({}); 
        } else {
            setViewMode('mine');
        }
    };

    const toggleBench = (rosterId) => {
        setExpandedBenches(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
    };

    const toggleTeamExpand = (rosterId) => {
        setExpandedTeams(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
    };

    const getPlayerLivePts = (pId, rosterId) => {
        if (!pId || pId === "0") return '0.00';
        const matchup = weeklyMatchups.find(m => m.roster_id === parseInt(rosterId));
        if (matchup?.players_points && matchup.players_points[pId] !== undefined) {
            return parseFloat(matchup.players_points[pId]).toFixed(2);
        }
        return '0.00';
    };

    const getPlayerProjPts = (playerId) => {
        const playerObj = getPlayerObj(playerId);
        const proj = weeklyProjections[playerId];
        const scoringSettings = leagueData?.scoring_settings || {};

        if (proj) {
            const stats = proj.stats || proj || {};
            let customPts = 0;
            let hasValidStats = false;

            for (const [statKey, statMultiplier] of Object.entries(scoringSettings)) {
                if (stats[statKey] !== undefined && typeof stats[statKey] === 'number') {
                    customPts += (stats[statKey] * statMultiplier);
                    hasValidStats = true;
                }
            }

            if (playerObj?.pos === 'TE' && scoringSettings.bonus_rec_te && stats.rec) {
                customPts += (stats.rec * scoringSettings.bonus_rec_te);
            }

            if (hasValidStats && customPts > 0) return customPts.toFixed(1);

            const rec = scoringSettings.rec || 0;
            let key = 'pts_std';
            if (rec === 1) key = 'pts_ppr';
            else if (rec === 0.5) key = 'pts_half_ppr';
            
            const basePts = stats[key] || proj[key] || 0;
            if (basePts > 0) return parseFloat(basePts).toFixed(1);
        }

        const cachePts = playerObj?.wi?.[activeWeek]?.p ? parseFloat(playerObj.wi[activeWeek].p) : 0;
        return cachePts > 0 ? cachePts.toFixed(1) : '0.0';
    };

    const getMatchupText = (playerId) => {
        const playerObj = getPlayerObj(playerId);
        if (!playerObj) return '';
        const team = normalizeTeam(playerObj.t || playerObj.team);
        
        if (team && nflScheduleMap[team]) {
            return nflScheduleMap[team];
        }
        if (weeklyProjections[playerId]?.opponent) {
            return formatOpponent(weeklyProjections[playerId].opponent);
        }
        if (playerObj?.wi?.[activeWeek]?.opp) {
            return formatOpponent(playerObj.wi[activeWeek].opp);
        }
        return 'BYE';
    };

    const getInjStatus = (status) => {
        if (!status) return null;
        const s = status.toLowerCase();
        if (s === 'questionable') return 'Q';
        if (s === 'out') return 'O';
        if (s === 'doubtful') return 'D';
        if (s === 'ir' || s === 'injured reserve') return 'IR';
        if (s === 'pup') return 'PUP';
        if (s === 'suspended') return 'SUS';
        return null;
    };

    const getAvatar = (pId, pMeta) => pMeta?.pos === 'DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${pId.toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;

    const getPositionStyle = (cleanPos) => {
        const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'BN', 'IR', 'TAXI'];
        const basePos = validPositions.includes(cleanPos) ? cleanPos : 'BN';
        return { backgroundColor: `var(--${basePos})`, color: '#0b0e14' };
    };

    const renderPlayerRow = (playerId, positionLabel, rosterId) => {
        const player = getPlayerObj(playerId);
        const isPlaceholder = playerId === "0" || !player;
        
        const matchupText = getMatchupText(playerId);
        const injTag = player ? getInjStatus(player.inj_status) : null;
                 
        return (
            <div 
                key={playerId + positionLabel + Math.random()} 
                className={styles.playerRow} 
                onClick={() => !isPlaceholder && setSelectedPlayer(player)}
                style={{ cursor: isPlaceholder ? 'default' : 'pointer' }}
            >
                <div className={styles.posBadge} style={getPositionStyle(positionLabel.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX'))}>
                    {positionLabel.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX')}
                </div>
                {isPlaceholder ? (
                    <div className={styles.playerInfoGroup}>
                        <div className={styles.playerImg} style={{ backgroundImage: `url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}></div>
                        <div className={styles.playerText}><span className={styles.pNameText}>Empty Slot</span></div>
                    </div>
                ) : (
                    <>
                        <div className={styles.playerInfoGroup}>
                            <div className={styles.playerImg} style={{ backgroundImage: `url(${getAvatar(playerId, player)}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}></div>
                            <div className={styles.playerMetaColLeft}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className={styles.pNameText}>{player.fn} {player.ln}</span>
                                    {injTag && <span className={styles.injTag}>{injTag}</span>}
                                </div>
                                <div className={styles.posText}>{player.pos} • {player.t || 'FA'}</div>
                                <div className={styles.schedText}>{matchupText}</div>
                            </div>
                        </div>
                        <div className={styles.scoreBlock}>
                            <span className={styles.playerLivePts}>{getPlayerLivePts(playerId, rosterId)}</span>
                            <span className={styles.playerProjSub}>{getPlayerProjPts(playerId)}</span>
                        </div>
                    </>
                )}
            </div>
        );
    };

    if (loading) return <div className={styles.loading}>Loading Teams...</div>;
    if (!leagueData || !teamManagers || Object.keys(rosters).length === 0) {
        return <div className={styles.loading}>No roster data available for this league.</div>;
    }

    const currentSeason = teamManagers.currentSeason;
    const rosterPositions = leagueData.roster_positions || [];

    const renderRosterCard = (rosterId, isConsolidated) => {
        const roster = rosters[rosterId];
        if (!roster) return null;
        
        const teamMeta = getTeamFromTeamManagers(teamManagers, rosterId, currentSeason);
        const teamStandings = standings[rosterId] || { wins: 0, losses: 0, ties: 0, fpts: 0 };
                 
        const starters = roster.starters || [];
        const allPlayers = roster.players || [];
        const reserve = roster.reserve || [];
        const taxi = roster.taxi || [];
        
        const startersSet = new Set(starters.map(String));
        const reserveSet = new Set(reserve.map(String));
        const taxiSet = new Set(taxi.map(String));
        
        const bench = allPlayers.filter(p => !startersSet.has(String(p)) && !reserveSet.has(String(p)) && !taxiSet.has(String(p)));
        const isBenchExpanded = expandedBenches[rosterId];
        const isTeamExpanded = viewMode === 'mine' || expandedTeams[rosterId];

        let teamProj = 0;
        starters.forEach(pId => {
            teamProj += parseFloat(getPlayerProjPts(pId));
        });

        return (
            <div key={rosterId} className={styles.rosterCard}>
                <div 
                    className={`${styles.teamHeader} ${viewMode === 'all' ? styles.clickable : ''}`} 
                    onClick={() => viewMode === 'all' && toggleTeamExpand(rosterId)}
                >
                    <img src={teamMeta.avatar} alt="Avatar" className={styles.teamAvatar} />
                    <div className={styles.teamDetails}>
                        <h3 className={styles.teamName}>{teamMeta.name}</h3>
                        <div className={styles.teamStats}>
                            Record: {teamStandings.wins}-{teamStandings.losses}{teamStandings.ties > 0 ? `-${teamStandings.ties}` : ''} | PF: {parseFloat(teamStandings.fpts).toFixed(2)}
                        </div>
                        <select className={styles.weekDropdown} value={activeWeek} onChange={(e) => { e.stopPropagation(); setActiveWeek(parseInt(e.target.value)); }}>
                            {[...Array(18).keys()].map(i => <option key={i+1} value={i+1}>Week {i+1}</option>)}
                        </select>
                    </div>
                    {viewMode === 'all' && (
                        <i className="material-icons" style={{ marginLeft: 'auto', color: '#94a3b8' }}>
                            {expandedTeams[rosterId] ? 'expand_less' : 'expand_more'}
                        </i>
                    )}
                </div>

                <div className={styles.teamProjBar}>
                    <div className={styles.teamProjText}>Wk {activeWeek} Projection</div>
                    <div className={styles.teamProjValue}>{teamProj.toFixed(2)} pts</div>
                </div>
                
                {isTeamExpanded && (
                    <div className={isConsolidated ? styles.rosterGridConsolidated : styles.rosterGrid}>
                        <div className={styles.rosterColumn}>
                            <h4 className={styles.sectionTitle}>Starting Lineup</h4>
                            <div className={styles.playerList}>
                                {starters.map((pId, idx) => renderPlayerRow(pId, rosterPositions[idx] || 'BN', rosterId))}
                            </div>
                        </div>
                        {isConsolidated ? (
                            <>
                                <button className={styles.toggleBenchBtn} onClick={(e) => { e.stopPropagation(); toggleBench(rosterId); }}>
                                    {isBenchExpanded ? 'Hide Bench' : 'Show Bench'}
                                </button>
                                                                 
                                {isBenchExpanded && (
                                    <div className={styles.rosterColumn}>
                                        <h4 className={styles.sectionTitle}>Bench</h4>
                                        <div className={styles.playerList}>{bench.map(pId => renderPlayerRow(pId, 'BN', rosterId))}</div>
                                        {reserve.length > 0 && (
                                            <>
                                                <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Injured Reserve</h4>
                                                <div className={styles.playerList}>{reserve.map(pId => renderPlayerRow(pId, 'IR', rosterId))}</div>
                                            </>
                                        )}
                                        {taxi.length > 0 && (
                                            <>
                                                <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Taxi Squad</h4>
                                                <div className={styles.playerList}>{taxi.map(pId => renderPlayerRow(pId, 'TAXI', rosterId))}</div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className={styles.rosterColumn}>
                                <h4 className={styles.sectionTitle}>Bench</h4>
                                <div className={styles.playerList}>{bench.map(pId => renderPlayerRow(pId, 'BN', rosterId))}</div>
                                {reserve.length > 0 && (
                                    <>
                                        <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Injured Reserve</h4>
                                        <div className={styles.playerList}>{reserve.map(pId => renderPlayerRow(pId, 'IR', rosterId))}</div>
                                    </>
                                )}
                                {taxi.length > 0 && (
                                    <>
                                        <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Taxi Squad</h4>
                                        <div className={styles.playerList}>{taxi.map(pId => renderPlayerRow(pId, 'TAXI', rosterId))}</div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={styles.container}>
            <div className={styles.controlsHeader}>
                <div className={styles.toggleContainer} onClick={handleToggleView}>
                    <div className={styles.toggleWrapper}>
                        <div className={`${styles.toggleSwitch} ${viewMode === 'all' ? styles.active : ''}`}></div>
                    </div>
                    <span className={styles.toggleLabel}>
                        {viewMode === 'mine' ? 'Show All Lineups' : 'Show My Lineup'}
                    </span>
                </div>
            </div>
            
            {viewMode === 'mine' ? (
                myRosterId ? renderRosterCard(myRosterId, false) : (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
                        Your team could not be automatically located in this league.
                    </div>
                )
            ) : (
                <div className={styles.allTeamsGrid}>
                    {Object.keys(rosters).map(rId => renderRosterCard(rId, true))}
                </div>
            )}

            {selectedPlayer && (
                <PlayerModal 
                    player={selectedPlayer} 
                    week={activeWeek} 
                    onClose={() => setSelectedPlayer(null)} 
                />
            )}
        </div>
    );
}