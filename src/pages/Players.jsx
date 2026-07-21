import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { loadPlayers, getLeagueData, getLeagueRosters } from '../utils/helper';
import { formatOpponent } from '../utils/helperFunctions/universalFunctions';
import PlayerModal from '../components/PlayerModal';
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
    const [nflScheduleMap, setNflScheduleMap] = useState({});
    const [trendingUp, setTrendingUp] = useState([]);
    const [trendingDown, setTrendingDown] = useState([]);
    
    // Navigation & Filters
    const [activeTab, setActiveTab] = useState('available'); // 'available', 'trends', 'news'
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [posFilter, setPosFilter] = useState('ALL');
    const [trendFilter, setTrendFilter] = useState('up'); // 'up', 'down'
    const [newsFilter, setNewsFilter] = useState('all'); // 'all', 'fantasy'
    
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'];

    // Sample News Items
    const rawNewsFeed = [
        { id: 1, tag: 'Breaking', category: 'all', time: '2h ago', title: 'Latest training camp updates around the league', desc: 'Coaches are adjusting depth charts as the preseason games approach. Keep an eye on backup running backs getting first-team reps.' },
        { id: 2, tag: 'Fantasy', category: 'fantasy', time: '5h ago', title: `Top waiver wire targets for Week ${activeWeek}`, desc: 'A breakdown of the highest projected players currently available in standard formats.' },
        { id: 3, tag: 'Injury Report', category: 'all', time: '1d ago', title: 'Key players questionable heading into the weekend', desc: 'Monitor practice logs closely. Several high-profile starters were limited in Friday\'s sessions.' },
        { id: 4, tag: 'Fantasy', category: 'fantasy', time: '1d ago', title: 'Start \'Em, Sit \'Em: High upside flex options', desc: 'Analyzing target shares and matchup advantages for upcoming weekly rosters.' }
    ];

    // Normalize team names for schedule lookup
    const normalizeTeam = (t) => {
        if (!t) return '';
        const map = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', NOH: 'NO' };
        const upper = String(t).toUpperCase();
        return map[upper] || upper;
    };

    // 1. Initial Load
    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const sleeperId = activeLeague.sleeper_league_id;
                const [pData, lData, rData] = await Promise.all([
                    loadPlayers(),
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

    // 2. Fetch Projections, Schedule, and Trends
    useEffect(() => {
        const season = leagueData?.season || new Date().getFullYear();
        let isMounted = true;

        // Projections
        fetch(`https://api.sleeper.app/v1/projections/nfl/regular/${season}/${activeWeek}`)
            .then(res => res.json())
            .then(data => { if (isMounted) setWeeklyProjections(data || {}); })
            .catch(err => console.error("Proj error:", err));

        // Schedule
        fetch(`https://api.sleeper.app/v1/schedule/nfl/regular/${season}/${activeWeek}`)
            .then(res => res.json())
            .then(sData => {
                if (isMounted && Array.isArray(sData)) {
                    const map = {};
                    sData.forEach(game => {
                        const home = normalizeTeam(game.home_team || game.home);
                        const away = normalizeTeam(game.away_team || game.away);
                        if (home && away) {
                            map[home] = `VS ${away}`;
                            map[away] = `@${home}`;
                        }
                    });
                    setNflScheduleMap(map);
                }
            }).catch(err => console.error("Sched error:", err));

        // Trends
        fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=30')
            .then(res => res.json())
            .then(data => { if (isMounted) setTrendingUp(data || []); }).catch(console.error);

        fetch('https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=24&limit=30')
            .then(res => res.json())
            .then(data => { if (isMounted) setTrendingDown(data || []); }).catch(console.error);

        return () => { isMounted = false; };
    }, [activeWeek, leagueData?.season]);

    // Calculate Projected Points
    const getProjPts = (pId) => {
        if (!pId) return '0.00';
        const proj = weeklyProjections[pId];
        if (proj) {
            const stats = proj.stats || proj || {};
            const scoringSettings = leagueData?.scoring_settings || {};
            let customPts = 0;
            let hasValidStats = false;
            for (const [statKey, statMultiplier] of Object.entries(scoringSettings)) {
                if (stats[statKey] !== undefined && typeof stats[statKey] === 'number') {
                    customPts += (stats[statKey] * statMultiplier);
                    hasValidStats = true;
                }
            }
            if (hasValidStats && customPts > 0) return customPts.toFixed(2);
            
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
        const team = normalizeTeam(playerObj.t || playerObj.team);
        if (team && nflScheduleMap[team]) return nflScheduleMap[team];
        if (playerObj.wi?.[activeWeek]?.opp) return formatOpponent(playerObj.wi[activeWeek].opp);
        return 'BYE';
    };

    const getAvatar = (pId, pos) => pos === 'DEF' 
        ? `https://sleepercdn.com/images/team_logos/nfl/${String(pId).toLowerCase()}.png` 
        : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;

    // 3. Robust Available Players Processing
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

        // Sort by Highest Projected Points first
        return list.sort((a, b) => b.projVal - a.projVal).slice(0, 100);
    }, [playersInfo, rosters, posFilter, searchQuery, weeklyProjections, nflScheduleMap]);

    // News Filtered Feed
    const filteredNews = useMemo(() => {
        if (newsFilter === 'fantasy') {
            return rawNewsFeed.filter(item => item.category === 'fantasy');
        }
        return rawNewsFeed;
    }, [newsFilter, activeWeek]);

    // Render Player Row Component
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
            {/* TOP HEADER NAV WITH SEARCH ICON ON LEFT */}
            <div className={styles.topHeader}>
                <button className={styles.searchToggleBtn} onClick={() => setIsSearchOpen(!isSearchOpen)}>
                    <i className="material-icons">{isSearchOpen ? 'close' : 'search'}</i>
                </button>
                <div className={styles.navTabs}>
                    <button className={`${styles.navTab} ${activeTab === 'available' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('available')}>Available</button>
                    <button className={`${styles.navTab} ${activeTab === 'trends' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('trends')}>Trends</button>
                    <button className={`${styles.navTab} ${activeTab === 'news' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('news')}>News</button>
                </div>
            </div>

            {/* EXPANDABLE SEARCH BAR */}
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

            {/* MAIN CONTENT AREA */}
            <div className={styles.contentArea}>
                
                {/* 1. AVAILABLE TAB */}
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

                {/* 2. TRENDS TAB */}
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

                {/* 3. NEWS TAB WITH WORKING FILTER */}
                {activeTab === 'news' && (
                    <>
                        <div className={styles.trendToggleBar}>
                            <button 
                                className={`${styles.trendToggleBtn} ${newsFilter === 'all' ? styles.activeTrendUp : ''}`}
                                onClick={() => setNewsFilter('all')}
                            >
                                All NFL
                            </button>
                            <button 
                                className={`${styles.trendToggleBtn} ${newsFilter === 'fantasy' ? styles.activeTrendUp : ''}`}
                                onClick={() => setNewsFilter('fantasy')}
                            >
                                Fantasy
                            </button>
                        </div>
                        
                        <div className={styles.newsFeed}>
                            {filteredNews.map(item => (
                                <div key={item.id} className={styles.newsCard}>
                                    <div className={styles.newsHeader}>
                                        <span className={item.category === 'fantasy' ? styles.newsTagFantasy : styles.newsTag}>
                                            {item.tag}
                                        </span>
                                        <span className={styles.newsTime}>{item.time}</span>
                                    </div>
                                    <h3 className={styles.newsTitle}>{item.title}</h3>
                                    <p className={styles.newsDesc}>{item.desc}</p>
                                </div>
                            ))}
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