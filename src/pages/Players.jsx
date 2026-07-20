import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { loadPlayers, getLeagueRosters, getLeagueTeamManagers } from '../utils/helper';
import { getTeamNameFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import PlayerModal from '../components/PlayerModal.jsx';
import styles from './Players.module.css';

// Unified Matchup Formatter - Forces strict uppercase 'VS' and '@'
const formatOpponent = (opp) => {
    if (!opp || opp === '-' || opp === 'BYE' || opp === 'TBD') return (opp || '').toUpperCase();
    
    const isAway = opp.includes('@');
    const cleanOpp = opp.replace(/[@]/g, '').replace(/vs\.?/gi, '').trim().toUpperCase();
    
    if (!cleanOpp) return '';
    return isAway ? `@ ${cleanOpp}` : `VS ${cleanOpp}`;
};

function PlayerAvatar({ pId, pos, className }) {
    const primaryUrl = pos === 'DEF' 
        ? `https://sleepercdn.com/images/team_logos/nfl/${pId.toLowerCase()}.png`
        : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;
    
    const fallbackUrl = 'https://sleepercdn.com/images/v2/icons/player_default.webp';
    const [imgSrc, setImgSrc] = useState(primaryUrl);

    useEffect(() => {
        setImgSrc(primaryUrl);
    }, [primaryUrl]);

    return (
        <div className={className} style={{ backgroundImage: `url(${imgSrc})` }}>
            <img 
                src={primaryUrl} 
                alt="" 
                style={{ display: 'none' }} 
                onError={() => setImgSrc(fallbackUrl)} 
            />
        </div>
    );
}

export default function Players() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [subTab, setSubTab] = useState('database'); 
    
    const [playersMap, setPlayersMap] = useState({});
    const [rosters, setRosters] = useState({});
    const [teamManagers, setTeamManagers] = useState(null);
    const [trendingAdds, setTrendingAdds] = useState([]);
    const [trendingDrops, setTrendingDrops] = useState([]);
    
    const [nflNews, setNflNews] = useState([]);
    const [fantasyNews, setFantasyNews] = useState([]);
    const [newsFilter, setNewsFilter] = useState('NFL'); 

    const [searchTerm, setSearchTerm] = useState('');
    const [posFilter, setPosFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('AVAILABLE'); 
    
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    useEffect(() => {
        const loadPlayersData = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [pData, rData, tmData] = await Promise.all([
                    loadPlayers(activeLeague.sleeper_league_id),
                    getLeagueRosters(activeLeague.sleeper_league_id),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id)
                ]);

                setPlayersMap(pData?.players || {});
                setRosters(rData?.rosters || {});
                setTeamManagers(tmData);

                const [addsRes, dropsRes] = await Promise.all([
                    fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=15').catch(()=>null),
                    fetch('https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=24&limit=15').catch(()=>null)
                ]);

                if (addsRes && addsRes.ok) setTrendingAdds(await addsRes.json());
                if (dropsRes && dropsRes.ok) setTrendingDrops(await dropsRes.json());

                try {
                    const eRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50`).catch(()=>null);
                    
                    if (eRes && eRes.ok) {
                        const eData = await eRes.json();
                        if (eData.articles && Array.isArray(eData.articles)) {
                            const espnArticles = eData.articles.map((item, idx) => ({
                                id: `espn-${item.id || idx}`,
                                title: item.headline || 'NFL Report',
                                description: item.description || item.story || '',
                                source: item.byline || 'ESPN Wire',
                                date: item.published ? new Date(item.published).toLocaleDateString() : 'Archive',
                                url: item.links?.web?.href || item.links?.mobile?.href || '',
                                image: item.images && item.images.length > 0 ? item.images[0].url : ''
                            }));

                            setNflNews(espnArticles);

                            const fantasyFiltered = espnArticles.filter(a => {
                                const txt = `${a.title} ${a.description}`.toLowerCase();
                                return txt.includes('fantasy') || 
                                       txt.includes('waiver') || 
                                       txt.includes('rankings') || 
                                       txt.includes('start') || 
                                       txt.includes('sit') || 
                                       txt.includes('roster');
                            });
                            
                            setFantasyNews(fantasyFiltered);
                        }
                    }
                } catch(err) {
                    console.warn("ESPN global fetch failed:", err);
                }

            } catch (err) {
                console.error("Failed to sync player page datasets:", err);
            } finally {
                setLoading(false);
            }
        };

        loadPlayersData();
    }, [activeLeague]);

    const playerOwnershipMap = useMemo(() => {
        const mapping = {};
        Object.entries(rosters).forEach(([rosterId, rosterObj]) => {
            if (rosterObj.players) {
                rosterObj.players.forEach(pId => {
                    mapping[pId] = rosterId;
                });
            }
        });
        return mapping;
    }, [rosters]);

    const filteredPlayers = useMemo(() => {
        let list = Object.entries(playersMap).map(([id, meta]) => ({ id, ...meta }));

        const validPos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
        list = list.filter(p => validPos.includes(p.pos));

        if (posFilter !== 'ALL') {
            list = list.filter(p => p.pos === posFilter);
        }

        if (statusFilter === 'AVAILABLE') {
            list = list.filter(p => !playerOwnershipMap[p.id]);
        }

        if (searchTerm.trim()) {
            const cleanSearch = searchTerm.toLowerCase();
            list = list.filter(p => 
                p.fn?.toLowerCase().includes(cleanSearch) || 
                p.ln?.toLowerCase().includes(cleanSearch) ||
                `${p.fn?.toLowerCase()} ${p.ln?.toLowerCase()}`.includes(cleanSearch)
            );
        }

        list.sort((a, b) => {
            const aProj = a.wi ? Math.max(0, ...Object.values(a.wi).map(w => w.p || 0)) : 0;
            const bProj = b.wi ? Math.max(0, ...Object.values(b.wi).map(w => w.p || 0)) : 0;
            
            if (bProj !== aProj) return bProj - aProj;

            const aHasTeam = (a.t && a.t !== 'FA') ? 1 : 0;
            const bHasTeam = (b.t && b.t !== 'FA') ? 1 : 0;
            
            if (aHasTeam !== bHasTeam) return bHasTeam - aHasTeam;
            return (a.ln || '').localeCompare(b.ln || '');
        });

        return list.slice(0, 50); 
    }, [playersMap, searchTerm, posFilter, statusFilter, playerOwnershipMap]);

    const getActiveWeek = (p) => p?.wi ? Object.keys(p.wi)[0] : 1;
    const activeNewsFeed = newsFilter === 'NFL' ? nflNews : fantasyNews;

    if (loading) return <div className={styles.loading}>Syncing Player Matrix...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.viewToggles}>
                <button className={`${styles.toggleBtn} ${subTab === 'database' ? styles.active : ''}`} onClick={() => setSubTab('database')}>
                    Player Market
                </button>
                <button className={`${styles.toggleBtn} ${subTab === 'trending' ? styles.active : ''}`} onClick={() => setSubTab('trending')}>
                    Trending
                </button>
                <button className={`${styles.toggleBtn} ${subTab === 'news' ? styles.active : ''}`} onClick={() => setSubTab('news')}>
                    NFL Updates
                </button>
            </div>

            {subTab === 'database' && (
                <div className={styles.workspace}>
                    <div className={styles.searchBarRow}>
                        <div className={styles.searchContainer}>
                            <i className="material-icons">search</i>
                            <input 
                                type="text" 
                                placeholder="Search player name..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className={styles.searchInput}
                            />
                        </div>
                        <select 
                            className={styles.posDropdown}
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="AVAILABLE">Available Only</option>
                            <option value="ALL">All Players</option>
                        </select>
                        <select 
                            className={styles.posDropdown}
                            value={posFilter}
                            onChange={(e) => setPosFilter(e.target.value)}
                        >
                            <option value="ALL">All Positions</option>
                            <option value="QB">Quarterbacks</option>
                            <option value="RB">Running Backs</option>
                            <option value="WR">Wide Receivers</option>
                            <option value="TE">Tight Ends</option>
                            <option value="DEF">Defenses</option>
                            <option value="K">Kickers</option>
                        </select>
                    </div>

                    <div className={styles.marketList}>
                        {filteredPlayers.length === 0 ? (
                            <div className={styles.emptyResults}>No matching players found.</div>
                        ) : (
                            filteredPlayers.map(player => {
                                const ownerRosterId = playerOwnershipMap[player.id];
                                const ownerName = ownerRosterId 
                                    ? getTeamNameFromTeamManagers(teamManagers, ownerRosterId, teamManagers?.currentSeason)
                                    : 'Free Agent';

                                return (
                                    <div 
                                        key={player.id} 
                                        className={styles.playerCard}
                                        onClick={() => setSelectedPlayer(player)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <div className={styles.playerInfo}>
                                            <PlayerAvatar 
                                                pId={player.id} 
                                                pos={player.pos} 
                                                className={styles.playerAvatar} 
                                            />
                                            <div className={styles.identityStack}>
                                                <span className={styles.playerName}>{player.fn} {player.ln}</span>
                                                <span className={styles.playerMeta}>
                                                    {/* Forced strictly to uppercase */}
                                                    {player.pos} — {(player.t || 'FA').toUpperCase()}
                                                    <span style={{ color: '#eebf1c', marginLeft: '6px', fontWeight: '800' }}>
                                                        {player.wi?.[getActiveWeek(player)]?.opp ? `| ${formatOpponent(player.wi[getActiveWeek(player)].opp)}` : ''}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                        <div className={`${styles.ownershipTag} ${ownerRosterId ? styles.owned : styles.freeAgent}`}>
                                            <i className="material-icons">{ownerRosterId ? 'assignment_ind' : 'add_task'}</i>
                                            <span>{ownerName}</span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {subTab === 'trending' && (
                <div className={styles.trendingGrid}>
                    <div className={styles.trendingCard}>
                        <h3 className={styles.trendingHeaderAdd}><i className="material-icons">trending_up</i> Top 24h Adds</h3>
                        <div className={styles.trendingList}>
                            {trendingAdds.map((item, idx) => {
                                const p = playersMap[item.player_id];
                                if (!p) return null;
                                return (
                                    <div 
                                        key={`add-${item.player_id}`} 
                                        className={styles.trendRow}
                                        onClick={() => setSelectedPlayer(p)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <span className={styles.trendRank}>{idx + 1}</span>
                                        <div className={styles.trendIdentity}>
                                            <span className={styles.trendName}>{p.fn} {p.ln}</span>
                                            {/* Forced strictly to uppercase */}
                                            <span className={styles.trendMeta}>{p.pos} — {(p.t || 'FA').toUpperCase()}</span>
                                        </div>
                                        <span className={styles.countBadgeAdd}>+{item.count}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className={styles.trendingCard}>
                        <h3 className={styles.trendingHeaderDrop}><i className="material-icons">trending_down</i> Top 24h Drops</h3>
                        <div className={styles.trendingList}>
                            {trendingDrops.map((item, idx) => {
                                const p = playersMap[item.player_id];
                                if (!p) return null;
                                return (
                                    <div 
                                        key={`drop-${item.player_id}`} 
                                        className={styles.trendRow}
                                        onClick={() => setSelectedPlayer(p)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <span className={styles.trendRank}>{idx + 1}</span>
                                        <div className={styles.trendIdentity}>
                                            <span className={styles.trendName}>{p.fn} {p.ln}</span>
                                            {/* Forced strictly to uppercase */}
                                            <span className={styles.trendMeta}>{p.pos} — {(p.t || 'FA').toUpperCase()}</span>
                                        </div>
                                        <span className={styles.countBadgeDrop}>-{item.count}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {subTab === 'news' && (
                <div className={styles.workspace}>
                    <div className={styles.viewToggles} style={{ marginBottom: '25px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '25px' }}>
                        <button 
                            className={`${styles.toggleBtn} ${newsFilter === 'NFL' ? styles.active : ''}`} 
                            onClick={() => setNewsFilter('NFL')}
                        >
                            All NFL News
                        </button>
                        <button 
                            className={`${styles.toggleBtn} ${newsFilter === 'FANTASY' ? styles.active : ''}`} 
                            onClick={() => setNewsFilter('FANTASY')}
                        >
                            Fantasy Analysis
                        </button>
                    </div>

                    <div className={styles.newsContainer}>
                        {activeNewsFeed.length === 0 ? (
                            <div className={styles.emptyResults}>No current {newsFilter} updates available.</div>
                        ) : (
                            activeNewsFeed.map((article, idx) => {
                                const CardWrapper = article.url ? 'a' : 'div';
                                const linkProps = article.url ? { 
                                    href: article.url, 
                                    target: "_blank", 
                                    rel: "noopener noreferrer",
                                    style: { textDecoration: 'none', color: 'inherit', display: 'flex', gap: '16px', alignItems: 'flex-start' }
                                } : { 
                                    style: { display: 'flex', gap: '16px', alignItems: 'flex-start' } 
                                };

                                return (
                                    <CardWrapper 
                                        key={`art-${article.id || idx}`} 
                                        className={styles.newsCard} 
                                        {...linkProps}
                                    >
                                        {article.image && (
                                            <div style={{ flexShrink: 0, width: '120px', height: '120px', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#0f172a' }}>
                                                <img 
                                                    src={article.image} 
                                                    alt="Thumbnail" 
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                                />
                                            </div>
                                        )}

                                        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                                            <div className={styles.newsHeader} style={{ marginBottom: '6px' }}>
                                                <span className={styles.newsAuthor} style={{ fontSize: '0.85em', color: '#94a3b8' }}>
                                                    {article.date ? `${article.date} via ` : 'via '}{article.source}
                                                </span>
                                            </div>
                                            
                                            <h3 className={styles.newsTitle} style={{ margin: '0 0 8px 0', fontSize: '1.1em' }}>
                                                {article.title}
                                            </h3>
                                            
                                            <div 
                                                className={styles.newsBody} 
                                                style={{ 
                                                    margin: 0, 
                                                    fontSize: '0.9em', 
                                                    lineHeight: '1.4', 
                                                    display: '-webkit-box', 
                                                    WebkitLineClamp: '2', 
                                                    WebkitBoxOrient: 'vertical', 
                                                    overflow: 'hidden' 
                                                }}
                                            >
                                                {article.description}
                                            </div>

                                            {article.url && (
                                                <div style={{ marginTop: '10px', fontSize: '0.85em', color: '#eebf1c', fontWeight: 'bold' }}>
                                                    Read Full Article ↗
                                                </div>
                                            )}
                                        </div>
                                    </CardWrapper>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {selectedPlayer && (
                <PlayerModal 
                    player={selectedPlayer} 
                    week={getActiveWeek(selectedPlayer)} 
                    onClose={() => setSelectedPlayer(null)} 
                />
            )}
        </div>
    );
}