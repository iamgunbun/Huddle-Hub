import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueRosters, getLeagueTeamManagers, loadPlayers, getLeagueData } from '../utils/helper';
import { getTeamFromTeamManagers, formatOpponent } from '../utils/helperFunctions/universalFunctions';
import PlayerModal from '../components/PlayerModal';
import styles from './Matchups.module.css';

export default function Matchups() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [rosters, setRosters] = useState({});
    const [teamManagers, setTeamManagers] = useState(null);
    const [playersInfo, setPlayersInfo] = useState({});
    const [leagueData, setLeagueData] = useState(null);
    const [myRosterId, setMyRosterId] = useState(null);
    
    // View & Toggle States
    const [viewMode, setViewMode] = useState('mine'); 
    const [activeWeek, setActiveWeek] = useState(1);
    const [weeklyMatchups, setWeeklyMatchups] = useState([]);
    const [weeklyProjections, setWeeklyProjections] = useState({});
    const [nflScheduleMap, setNflScheduleMap] = useState({});
    
    // FIX 1: Restored selectedMatchupId state
    const [selectedMatchupId, setSelectedMatchupId] = useState(null);
    const [expandedMatchups, setExpandedMatchups] = useState({});
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [showBench, setShowBench] = useState({});

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
                const sleeperId = activeLeague.sleeper_league_id;
                const [rData, tmData, pData, lData] = await Promise.all([
                    getLeagueRosters(sleeperId),
                    getLeagueTeamManagers(sleeperId),
                    loadPlayers(),
                    getLeagueData(sleeperId)
                ]);
                if (!isMounted) return;
                                 
                setRosters(rData.rosters || {});
                setTeamManagers(tmData);
                setPlayersInfo(pData.players || {});
                setLeagueData(lData);
                
                if (lData?.display_week) setActiveWeek(lData.display_week);
                                 
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
                    if (searchName) {
                        const rostersMap = tmData.teamManagersMap[tmData.currentSeason] || {};
                        const foundRosterId = Object.keys(rostersMap).find(rId => normalizeStr(rostersMap[rId].team?.name) === searchName);
                        if (foundRosterId) setMyRosterId(foundRosterId);
                    }
                }
            } catch (e) {
                console.error("Failed to load matchups:", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    // 2. Fetch Weekly Matchups, Projections, AND Valid Weekly Schedule Endpoint
    useEffect(() => {
        const season = leagueData?.season || new Date().getFullYear();
        if (!activeLeague?.sleeper_league_id) return;
        let isMounted = true;
        
        // Matchups Fetch
        fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}/matchups/${activeWeek}`)
            .then(res => res.json())
            .then(mData => {
                if (isMounted) {
                    setWeeklyMatchups(mData || []);
                    if (myRosterId && Array.isArray(mData)) {
                        const userM = mData.find(m => m.roster_id === parseInt(myRosterId));
                        if (userM) setSelectedMatchupId(userM.matchup_id);
                        else if (mData.length > 0) setSelectedMatchupId(mData[0].matchup_id);
                    } else if (mData && mData.length > 0) {
                        setSelectedMatchupId(mData[0].matchup_id);
                    }
                }
            })
            .catch(err => console.error("Matchups fetch err:", err));

        // Projections Fetch
        fetch(`https://api.sleeper.app/v1/projections/nfl/regular/${season}/${activeWeek}`)
            .then(res => res.json())
            .then(pData => {
                if (isMounted) setWeeklyProjections(pData || {});
            })
            .catch(err => console.error("Projections fetch err:", err));

        // FIX 2: Valid Weekly Schedule Endpoint (Prevents 404 & JSON Crash)
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
    }, [activeLeague, activeWeek, leagueData?.season, myRosterId]);

    const getPlayerLivePts = (pId, matchupObj) => {
        if (!pId || pId === "0") return '0.00';
        if (matchupObj?.players_points && matchupObj.players_points[pId] !== undefined) {
            return parseFloat(matchupObj.players_points[pId]).toFixed(2);
        }
        return '0.00';
    };

    const getPlayerProjPts = (pId) => {
        if (!pId || pId === "0") return '0.00';
        const playerObj = getPlayerObj(pId);
        const proj = weeklyProjections[pId];
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

            if (hasValidStats && customPts > 0) return customPts.toFixed(2);

            const rec = scoringSettings.rec || 0;
            let key = 'pts_std';
            if (rec === 1) key = 'pts_ppr';
            else if (rec === 0.5) key = 'pts_half_ppr';

            const basePts = stats[key] || proj[key] || 0;
            if (basePts > 0) return parseFloat(basePts).toFixed(2);
        }

        const cachePts = playerObj?.wi?.[activeWeek]?.p ? parseFloat(playerObj.wi[activeWeek].p) : 0;
        return cachePts > 0 ? cachePts.toFixed(2) : '0.00';
    };

    const getMatchupOpp = (pId) => {
        const playerObj = getPlayerObj(pId);
        if (!playerObj) return '';
        const team = normalizeTeam(playerObj.t || playerObj.team);
        
        if (team && nflScheduleMap[team]) {
            return nflScheduleMap[team];
        }
        if (weeklyProjections[pId]?.opponent) {
            return formatOpponent(weeklyProjections[pId].opponent);
        }
        if (playerObj?.wi?.[activeWeek]?.opp) {
            return formatOpponent(playerObj.wi[activeWeek].opp);
        }
        return 'BYE';
    };

    const formatShortName = (pObj) => {
        if (!pObj) return 'Empty';
        if (!pObj.fn || !pObj.ln) return pObj.name || 'Player';
        return `${pObj.fn.charAt(0)}. ${pObj.ln}`;
    };

    const toggleMatchupExpand = (mId) => {
        setExpandedMatchups(prev => ({ ...prev, [mId]: !prev[mId] }));
    };

    const toggleBenchExpand = (mId) => {
        setShowBench(prev => ({ ...prev, [mId]: !prev[mId] }));
    };

    if (loading) return <div className={styles.loading}>Loading Matchups...</div>;

    const matchupGroups = {};
    weeklyMatchups.forEach(m => {
        if (!matchupGroups[m.matchup_id]) matchupGroups[m.matchup_id] = [];
        matchupGroups[m.matchup_id].push(m);
    });

    const currentSeason = teamManagers?.currentSeason;
    const rosterPositions = leagueData?.roster_positions || [];

    const renderMatchupCard = (mId, pair, isSingleView = false) => {
        const leftTeamMatchup = pair[0] || null;
        const rightTeamMatchup = pair[1] || null;

        const leftTeamMeta = leftTeamMatchup ? getTeamFromTeamManagers(teamManagers, leftTeamMatchup.roster_id, currentSeason) : null;
        const rightTeamMeta = rightTeamMatchup ? getTeamFromTeamManagers(teamManagers, rightTeamMatchup.roster_id, currentSeason) : null;

        const leftRoster = leftTeamMatchup ? rosters[leftTeamMatchup.roster_id] : null;
        const rightRoster = rightTeamMatchup ? rosters[rightTeamMatchup.roster_id] : null;

        const leftStarters = leftRoster?.starters || [];
        const rightStarters = rightRoster?.starters || [];

        const leftLiveScore = leftTeamMatchup?.points || 0;
        const rightLiveScore = rightTeamMatchup?.points || 0;

        let leftProjTotal = 0;
        leftStarters.forEach(id => leftProjTotal += parseFloat(getPlayerProjPts(id)));

        let rightProjTotal = 0;
        rightStarters.forEach(id => rightProjTotal += parseFloat(getPlayerProjPts(id)));

        let leftWinProb = 50;
        let rightWinProb = 50;
        if (leftProjTotal + rightProjTotal > 0) {
            leftWinProb = Math.round((leftProjTotal / (leftProjTotal + rightProjTotal)) * 100);
            rightWinProb = 100 - leftWinProb;
        }

        const isLeftHigher = leftWinProb >= rightWinProb;
        const leftOddStyle = isLeftHigher ? styles.goldOdd : styles.redOdd;
        const rightOddStyle = !isLeftHigher ? styles.goldOdd : styles.redOdd;

        const leftBench = leftRoster?.players ? leftRoster.players.filter(p => !leftStarters.includes(p)) : [];
        const rightBench = rightRoster?.players ? rightRoster.players.filter(p => !rightStarters.includes(p)) : [];
        const maxBenchLength = Math.max(leftBench.length, rightBench.length);

        const isExpanded = isSingleView || expandedMatchups[mId];

        return (
            <div key={mId} className={styles.matchupCard}>
                <div 
                    className={`${styles.matchupBanner} ${!isSingleView ? styles.clickableBanner : ''}`}
                    onClick={() => !isSingleView && toggleMatchupExpand(mId)}
                >
                    <div className={styles.bannerTeam}>
                        <div className={styles.avatarRow}>
                            <img src={leftTeamMeta?.avatar || 'https://sleepercdn.com/images/v2/icons/league_default.webp'} alt="" className={styles.bannerAvatar} />
                            <span className={`${styles.winBadge} ${leftOddStyle}`}>{leftWinProb}% WIN</span>
                        </div>
                        <div className={styles.scoreGroup}>
                            <span className={styles.teamLiveScore}>{leftLiveScore.toFixed(2)}</span>
                            <span className={styles.teamProjSub}>Proj {leftProjTotal.toFixed(2)}</span>
                        </div>
                        <div className={styles.bannerTeamName}>{leftTeamMeta?.name || 'Home Team'}</div>
                    </div>

                    <div className={styles.bannerVsBadge}>
                        <i className="material-icons">bolt</i>
                    </div>

                    <div className={styles.bannerTeam} style={{ alignItems: 'flex-end', textAlign: 'right' }}>
                        <div className={styles.avatarRow} style={{ flexDirection: 'row-reverse' }}>
                            <img src={rightTeamMeta?.avatar || 'https://sleepercdn.com/images/v2/icons/league_default.webp'} alt="" className={styles.bannerAvatar} />
                            <span className={`${styles.winBadge} ${rightOddStyle}`}>{rightWinProb}% WIN</span>
                        </div>
                        <div className={styles.scoreGroup} style={{ alignItems: 'flex-end' }}>
                            <span className={styles.teamLiveScore}>{rightLiveScore.toFixed(2)}</span>
                            <span className={styles.teamProjSub}>Proj {rightProjTotal.toFixed(2)}</span>
                        </div>
                        <div className={styles.bannerTeamName}>{rightTeamMeta?.name || 'Away Team'}</div>
                    </div>
                </div>

                {isExpanded && (
                    <div className={styles.startersSection}>
                        <h4 className={styles.startersHeader}>Starters</h4>

                        <div className={styles.matchupGrid}>
                            {leftStarters.map((leftPId, idx) => {
                                const rightPId = rightStarters[idx] || "0";
                                const posLabel = rosterPositions[idx] || 'FLEX';

                                const leftP = getPlayerObj(leftPId);
                                const rightP = getPlayerObj(rightPId);
                                const cleanPos = posLabel.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX');

                                return (
                                    <div key={idx} className={styles.starterRow}>
                                        <div className={styles.leftPlayer} onClick={() => leftP && setSelectedPlayer(leftP)}>
                                            <div className={styles.playerMetaColLeft}>
                                                <div className={styles.pNameText}>{leftP ? formatShortName(leftP) : 'Empty Slot'}</div>
                                                {leftP && (
                                                    <>
                                                        <div className={styles.posText}>{leftP.pos} • {leftP.t || 'FA'}</div>
                                                        <div className={styles.schedText}>{getMatchupOpp(leftPId)}</div>
                                                    </>
                                                )}
                                            </div>
                                            <div className={styles.scoreBlock} style={{ alignItems: 'flex-end' }}>
                                                <span className={styles.playerLivePts}>{getPlayerLivePts(leftPId, leftTeamMatchup)}</span>
                                                <span className={styles.playerProjSub}>{getPlayerProjPts(leftPId)}</span>
                                            </div>
                                        </div>

                                        <div className={styles.centerPosBadge} style={{ backgroundColor: `var(--${(cleanPos || 'BN').toUpperCase()})` }}>
                                            {cleanPos}
                                        </div>

                                        <div className={styles.rightPlayer} onClick={() => rightP && setSelectedPlayer(rightP)}>
                                            <div className={styles.scoreBlock} style={{ alignItems: 'flex-start' }}>
                                                <span className={styles.playerLivePts}>{getPlayerLivePts(rightPId, rightTeamMatchup)}</span>
                                                <span className={styles.playerProjSub}>{getPlayerProjPts(rightPId)}</span>
                                            </div>
                                            <div className={styles.playerMetaColRight}>
                                                <div className={styles.pNameText}>{rightP ? formatShortName(rightP) : 'Empty Slot'}</div>
                                                {rightP && (
                                                    <>
                                                        <div className={styles.posText}>{rightP.pos} • {rightP.t || 'FA'}</div>
                                                        <div className={styles.schedText}>{getMatchupOpp(rightPId)}</div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button className={styles.benchToggleBtn} onClick={() => toggleBenchExpand(mId)}>
                            {showBench[mId] ? 'Hide Bench' : 'Show Bench'}
                        </button>

                        {showBench[mId] && (
                            <div className={styles.benchSection}>
                                <h4 className={styles.startersHeader} style={{ marginTop: '20px' }}>Bench</h4>
                                <div className={styles.matchupGrid}>
                                    {[...Array(maxBenchLength).keys()].map((idx) => {
                                        const leftPId = leftBench[idx] || "0";
                                        const rightPId = rightBench[idx] || "0";

                                        const leftP = getPlayerObj(leftPId);
                                        const rightP = getPlayerObj(rightPId);

                                        return (
                                            <div key={`bench-${idx}`} className={styles.starterRow}>
                                                <div className={styles.leftPlayer} onClick={() => leftP && setSelectedPlayer(leftP)}>
                                                    <div className={styles.playerMetaColLeft}>
                                                        <div className={styles.pNameText}>{leftP ? formatShortName(leftP) : 'Empty'}</div>
                                                        {leftP && (
                                                            <>
                                                                <div className={styles.posText}>{leftP.pos} • {leftP.t || 'FA'}</div>
                                                                <div className={styles.schedText}>{getMatchupOpp(leftPId)}</div>
                                                            </>
                                                        )}
                                                    </div>
                                                    <div className={styles.scoreBlock} style={{ alignItems: 'flex-end' }}>
                                                        <span className={styles.playerLivePts}>{getPlayerLivePts(leftPId, leftTeamMatchup)}</span>
                                                        <span className={styles.playerProjSub}>{getPlayerProjPts(leftPId)}</span>
                                                    </div>
                                                </div>

                                                <div className={styles.centerPosBadge} style={{ backgroundColor: '#334155', color: '#f8fafc' }}>
                                                    BN
                                                </div>

                                                <div className={styles.rightPlayer} onClick={() => rightP && setSelectedPlayer(rightP)}>
                                                    <div className={styles.scoreBlock} style={{ alignItems: 'flex-start' }}>
                                                        <span className={styles.playerLivePts}>{getPlayerLivePts(rightPId, rightTeamMatchup)}</span>
                                                        <span className={styles.playerProjSub}>{getPlayerProjPts(rightPId)}</span>
                                                    </div>
                                                    <div className={styles.playerMetaColRight}>
                                                        <div className={styles.pNameText}>{rightP ? formatShortName(rightP) : 'Empty'}</div>
                                                        {rightP && (
                                                            <>
                                                                <div className={styles.posText}>{rightP.pos} • {rightP.t || 'FA'}</div>
                                                                <div className={styles.schedText}>{getMatchupOpp(rightPId)}</div>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    let userMatchupPair = null;
    let userMatchupId = null;

    if (myRosterId && weeklyMatchups.length > 0) {
        const myM = weeklyMatchups.find(m => m.roster_id === parseInt(myRosterId));
        if (myM) {
            userMatchupId = myM.matchup_id;
            userMatchupPair = matchupGroups[userMatchupId] || null;
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.controlsHeader}>
                <div className={styles.toggleContainer} onClick={() => setViewMode(viewMode === 'mine' ? 'all' : 'mine')}>
                    <div className={styles.toggleWrapper}>
                        <div className={`${styles.toggleSwitch} ${viewMode === 'all' ? styles.active : ''}`}></div>
                    </div>
                    <span className={styles.toggleLabel}>
                        {viewMode === 'mine' ? 'Show All Matchups' : 'Show My Matchup'}
                    </span>
                </div>

                <select 
                    className={styles.weekDropdown} 
                    value={activeWeek} 
                    onChange={(e) => setActiveWeek(parseInt(e.target.value))}
                >
                    {[...Array(18).keys()].map(i => (
                        <option key={i+1} value={i+1}>Week {i+1}</option>
                    ))}
                </select>
            </div>

            {viewMode === 'mine' ? (
                userMatchupPair ? (
                    renderMatchupCard(userMatchupId, userMatchupPair, true)
                ) : (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
                        Your matchup could not be found for Week {activeWeek}.
                    </div>
                )
            ) : (
                <div className={styles.allMatchupsGrid}>
                    {Object.entries(matchupGroups).map(([mId, pair]) => renderMatchupCard(mId, pair, false))}
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