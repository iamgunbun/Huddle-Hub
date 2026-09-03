import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { loadPlayers, getLeagueData, getLeagueRosters } from '../utils/helper';
import PlayerModal from '../components/PlayerModal';
import { scoreStatLine } from '../utils/yahooScoring';
import styles from './Players.module.css';

export default function Players() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [playersInfo, setPlayersInfo] = useState({});
    const [leagueData, setLeagueData] = useState(null);
    const [rosters, setRosters] = useState({});
    
    // Live Data
    const [activeWeek, setActiveWeek] = useState(1);
    const [weeklyProjections, setWeeklyProjections] = useState({});
    const [weeklyStats, setWeeklyStats] = useState({}); 
    const [nflScheduleMap, setNflScheduleMap] = useState({});
    const [trendingUp, setTrendingUp] = useState([]);
    const [trendingDown, setTrendingDown] = useState([]);
    
    // Navigation & Filters
    const [activeTab, setActiveTab] = useState('available');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [posFilter, setPosFilter] = useState('ALL');
    const [trendFilter, setTrendFilter] = useState('up');
    
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'];

    const normalizeTeam = (t) => {
        if (!t) return '';
        const map = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', NOH: 'NO' };
        const upper = String(t).toUpperCase();
        return map[upper] || upper;
    };

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const sleeperId = activeLeague.sleeper_league_id;
                const [pData, lData, rData] = await Promise.all([
                    loadPlayers(sleeperId),
                    getLeagueData(sleeperId),
                    getLeagueRosters(sleeperId)
                ]);
                
                if (!isMounted) return;
                setPlayersInfo(pData.players || pData || {});
                setLeagueData(lData);
                setRosters(rData.rosters || {});
                if (lData?.display_week) setActiveWeek(lData.display_week);
                
            } catch (e) {
                console.error("Failed to load base player data:", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    useEffect(() => {
        const season = leagueData?.season || new Date().getFullYear();
        let isMounted = true;

        fetch(`https://api.sleeper.com/projections/nfl/${season}/${activeWeek}?season_type=regular`)
            .then(res => res.json())
            .then(data => {
                if (isMounted) {
                    if (Array.isArray(data)) {
                        const map = {};
                        data.forEach(item => { if (item.player_id) map[item.player_id] = item; });
                        setWeeklyProjections(map);
                    } else {
                        setWeeklyProjections(data || {});
                    }
                }
            })
            .catch(err => console.error("Proj error:", err));

        fetch(`https://api.sleeper.com/stats/nfl/${season}/${activeWeek}?season_type=regular`)
            .then(res => res.json())
            .then(data => {
                if (isMounted) {
                    if (Array.isArray(data)) {
                        const map = {};
                        data.forEach(item => { if (item.player_id) map[item.player_id] = item; });
                        setWeeklyStats(map);
                    } else {
                        setWeeklyStats(data || {});
                    }
                }
            })
            .catch(err => console.error("Stats error:", err));

        fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${activeWeek}&dates=${season}`)
            .then(res => res.json())
            .then(data => {
                if (isMounted && data?.events) {
                    const map = {};
                    data.events.forEach(event => {
                        const comp = event.competitions?.[0];
                        if (comp && comp.competitors) {
                            const homeTeam = comp.competitors.find(c => c.homeAway === 'home')?.team?.abbreviation;
                            const awayTeam = comp.competitors.find(c => c.homeAway === 'away')?.team?.abbreviation;
                            
                            if (homeTeam && awayTeam) {
                                const home = normalizeTeam(homeTeam);
                                const away = normalizeTeam(awayTeam);
                                map[home] = `VS ${away}`;
                                map[away] = `@ ${home}`; 
                            }
                        }
                    });
                    setNflScheduleMap(map);
                }
            })
            .catch(err => console.error("ESPN Schedule fetch err:", err));

        fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=72&limit=30')
            .then(res => res.json())
            .then(data => { if (isMounted) setTrendingUp(data || []); }).catch(console.error);

        fetch('https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=72&limit=30')
            .then(res => res.json())
            .then(data => { if (isMounted) setTrendingDown(data || []); }).catch(console.error);

        return () => { isMounted = false; };
    }, [activeWeek, leagueData?.season]);

    const getProjPts = (pId) => {
        if (!pId) return '0.00';
        // Sleeper's projections/stats feeds are keyed by Sleeper player ids, but
        // in a Yahoo league these ids are Yahoo's -- fall back to the player's
        // crosswalked sleeper_id so the lookup doesn't miss and report 0.
        const sleeperKey = (playersInfo[pId] || playersInfo[String(pId)])?.sleeper_id;
        const proj = weeklyProjections[pId] || weeklyStats[pId]
            || (sleeperKey ? (weeklyProjections[sleeperKey] || weeklyStats[sleeperKey]) : null);
        if (proj) {
            const stats = proj.stats || proj || {};
            const scoringSettings = leagueData?.scoring_settings || {};
            const playerPos = (playersInfo[pId] || playersInfo[String(pId)])?.pos;
            // Score against the league's own rules (defense tiers, kicker FG
            // distances); null means the line carried none of the scored stats.
            const scored = scoreStatLine(stats, scoringSettings, playerPos);
            if (scored !== null) return scored.toFixed(2);
            
            const rec = scoringSettings.rec || 0;
            let key = 'pts_std';
            if (rec === 1) key = 'pts_ppr';
            else if (rec === 0.5) key = 'pts_half_ppr';
            const basePts = stats[key] || proj[key] || 0;
            if (basePts > 0) return parseFloat(basePts).toFixed(2);
        }
        return '0.00';
    };

    const getMatchupText = (playerObj) => {
        if (!playerObj) return '';
        const pId = playerObj.player_id || playerObj.id;
        const sleeperKey = playerObj.sleeper_id;
        const proj = weeklyProjections[pId] || (sleeperKey ? weeklyProjections[sleeperKey] : null);
        const stats = weeklyStats[pId] || (sleeperKey ? weeklyStats[sleeperKey] : null);
        const team = normalizeTeam(playerObj.t || playerObj.team);

        if (team && nflScheduleMap[team]) {
            return nflScheduleMap[team];
        }

        let rawOpp = playerObj?.wi?.[activeWeek]?.opp || stats?.opponent || proj?.opponent || '';

        if (!rawOpp || rawOpp === '-' || rawOpp === 'BYE') return 'BYE';

        let isAway = rawOpp.includes('@');
        let cleanOpp = rawOpp.replace(/[@]/g, '').replace(/vs\.?/gi, '').trim().toUpperCase();

        return isAway ? `@ ${cleanOpp}` : `VS ${cleanOpp}`;
    };

    const getAvatar = (pId, pos) => pos === 'DEF' 
        ? `https://sleepercdn.com/images/team_logos/nfl/${String(pId).toLowerCase()}.png` 
        : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;

    const availablePlayers = useMemo(() => {
        if (!playersInfo || Object.keys(playersInfo).length === 0) return [];
        
        const ownedSet = new Set();
        if (rosters && typeof rosters === 'object') {
            Object.values(rosters).forEach(r => {
                if (r && Array.isArray(r.players)) {
                    r.players.forEach(pId => ownedSet.add(String(pId)));
                }
            });
        }
        
        const validPositions = new Set(['QB', 'RB', 'WR', 'TE', 'DEF', 'K']);
        let list = Object.entries(playersInfo).map(([id, p]) => {
            const pId = p.player_id || id;
            const pos = p.pos || p.position;
            const firstName = p.fn || p.first_name || '';
            const lastName = p.ln || p.last_name || '';
            const team = p.t || p.team || 'FA';
            
            return {
                ...p,
                player_id: pId,
                pos,
                fn: firstName,
                ln: lastName,
                t: team,
                projVal: parseFloat(getProjPts(pId)) || 0
            };
        }).filter(p => {
            const isOwned = ownedSet.has(String(p.player_id));
            const isValidPos = validPositions.has(p.pos);
            const isActive = p.active !== false && p.status !== 'Inactive';
            return !isOwned && isValidPos && isActive;
        });

        if (posFilter !== 'ALL') {
            list = list.filter(p => p.pos === posFilter);
        }
        
        if (searchQuery) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter(p => {
                const fn = p.fn.toLowerCase();
                const ln = p.ln.toLowerCase();
                const full = (p.full_name || `${fn} ${ln}`).toLowerCase();
                return fn.includes(q) || ln.includes(q) || full.includes(q);
            });
        }
        
        return list.sort((a, b) => b.projVal - a.projVal).slice(0, 100);
    }, [playersInfo, rosters, posFilter, searchQuery, weeklyProjections, weeklyStats, nflScheduleMap]);

    const renderPlayerRow = (pId, pObj = null, trendCount = null) => {
        const player = pObj || playersInfo[pId] || playersInfo[String(pId)];
        if (!player) return null;
        
        const playerId = player.player_id || pId;
        const matchup = getMatchupText(player);
        const proj = getProjPts(playerId);

        return (
            <div key={playerId} className={styles.playerRow} onClick={() => setSelectedPlayer(player)}>
                <div className={styles.playerInfoGroup}>
                    <div className={styles.playerImg} style={{ backgroundImage: `url(${getAvatar(playerId, player.pos)}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}></div>
                    <div className={styles.playerMetaColLeft}>
                        <div className={styles.pNameText}>{player.fn || player.first_name} {player.ln || player.last_name}</div>
                        <div className={styles.posText}>{player.pos} • {player.t || player.team || 'FA'}</div>
                        <div className={styles.schedText}>{matchup}</div>
                    </div>
                </div>
                
                <div className={styles.scoreBlock}>
                    {trendCount ? (
                        <>
                            <span className={styles.playerLivePts} style={{ color: trendFilter === 'up' ? '#00ceb8' : '#ef4444' }}>
                                {trendFilter === 'up' ? '+' : '-'}{trendCount}
                            </span>
                            <span className={styles.playerProjSub}>{trendFilter === 'up' ? 'Adds' : 'Drops'}</span>
                        </>
                    ) : (
                        <span className={styles.playerLivePts}>{proj}</span>
                    )}
                </div>
            </div>
        );
    };

    if (loading) return <div className={styles.loading}>Loading Players...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.topHeader}>
                <button className={styles.searchToggleBtn} onClick={() => setIsSearchOpen(!isSearchOpen)}>
                    <i className="material-icons">{isSearchOpen ? 'close' : 'search'}</i>
                </button>
                <div className={styles.navTabs}>
                    <button className={`${styles.navTab} ${activeTab === 'available' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('available')}>Available</button>
                    <button className={`${styles.navTab} ${activeTab === 'trends' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('trends')}>Trends</button>
                </div>
            </div>

            {isSearchOpen && (
                <div className={styles.searchContainer}>
                    <input 
                        type="text" 
                        placeholder="Search players..." 
                        className={styles.searchInput}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                </div>
            )}

            <div className={styles.contentArea}>
                {activeTab === 'available' && (
                    <>
                        <div className={styles.posFilterBar}>
                            {positions.map(pos => (
                                <button 
                                    key={pos} 
                                    className={`${styles.posFilterBtn} ${posFilter === pos ? styles.activePosBtn : ''}`}
                                    onClick={() => setPosFilter(pos)}
                                >
                                    {pos}
                                </button>
                            ))}
                        </div>
                        <div className={styles.playerListContainer}>
                            {availablePlayers.length > 0 ? (
                                availablePlayers.map(p => renderPlayerRow(p.player_id, p))
                            ) : (
                                <div className={styles.emptyState}>No available players found.</div>
                            )}
                        </div>
                    </>
                )}

                {activeTab === 'trends' && (
                    <>
                        <div className={styles.trendToggleBar}>
                            <button 
                                className={`${styles.trendToggleBtn} ${trendFilter === 'up' ? styles.activeTrendUp : ''}`}
                                onClick={() => setTrendFilter('up')}
                            >
                                <i className="material-icons">trending_up</i> Upward
                            </button>
                            <button 
                                className={`${styles.trendToggleBtn} ${trendFilter === 'down' ? styles.activeTrendDown : ''}`}
                                onClick={() => setTrendFilter('down')}
                            >
                                <i className="material-icons">trending_down</i> Downward
                            </button>
                        </div>
                        <div className={styles.playerListContainer}>
                            {trendFilter === 'up' 
                                ? trendingUp.map(t => renderPlayerRow(t.player_id, null, t.count))
                                : trendingDown.map(t => renderPlayerRow(t.player_id, null, t.count))
                            }
                        </div>
                    </>
                )}
            </div>

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