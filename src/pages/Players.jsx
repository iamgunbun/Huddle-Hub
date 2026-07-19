import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { loadPlayers, getLeagueRosters, getLeagueTeamManagers, getNews } from '../utils/helper';
import { getTeamNameFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import PlayerModal from '../components/PlayerModal';
import styles from './Players.module.css';

export default function Players() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [subTab, setSubTab] = useState('database'); 
    
    const [playersMap, setPlayersMap] = useState({});
    const [rosters, setRosters] = useState({});
    const [teamManagers, setTeamManagers] = useState(null);
    const [trendingAdds, setTrendingAdds] = useState([]);
    const [trendingDrops, setTrendingDrops] = useState([]);
    const [newsArticles, setNewsArticles] = useState([]);

    const [searchTerm, setSearchTerm] = useState('');
    const [posFilter, setPosFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('AVAILABLE'); 
    
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    useEffect(() => {
        const loadPlayersData = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [pData, rData, tmData, newsData] = await Promise.all([
                    loadPlayers(activeLeague.sleeper_league_id),
                    getLeagueRosters(activeLeague.sleeper_league_id),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    getNews() // <-- CRITICAL FIX: Removed the "true" boolean parameter to fix smartFetch error
                ]);

                setPlayersMap(pData?.players || {});
                setRosters(rData?.rosters || {});
                setTeamManagers(tmData);
                setNewsArticles(newsData?.articles || []);

                const [addsRes, dropsRes] = await Promise.all([
                    fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=15'),
                    fetch('https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=24&limit=15')
                ]);

                if (addsRes.ok) setTrendingAdds(await addsRes.json());
                if (dropsRes.ok) setTrendingDrops(await dropsRes.json());

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

    const getPlayerAvatar = (pId, pos) => {
        if (pos === 'DEF') return `https://sleepercdn.com/images/team_logos/nfl/${pId.toLowerCase()}.png`;
        return `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;
    };

    const getActiveWeek = (p) => p?.wi ? Object.keys(p.wi)[0] : 1;

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
                                            <div 
                                                className={styles.playerAvatar} 
                                                style={{ 
                                                    backgroundImage: `url(${getPlayerAvatar(player.id, player.pos)}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` 
                                                }}
                                            />
                                            <div className={styles.identityStack}>
                                                <span className={styles.playerName}>{player.fn} {player.ln}</span>
                                                <span className={styles.playerMeta}>
                                                    {player.pos} — {player.t || 'FA'}
                                                    <span style={{ color: '#eebf1c', marginLeft: '6px', fontWeight: '800' }}>
                                                        {player.wi?.[getActiveWeek(player)]?.opp ? `| ${player.wi[getActiveWeek(player)].opp}` : ''}
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
                                            <span className={styles.trendMeta}>{p.pos} — {p.t || 'FA'}</span>
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
                                            <span className={styles.trendMeta}>{p.pos} — {p.t || 'FA'}</span>
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
                <div className={styles.newsContainer}>
                    {newsArticles.length === 0 ? (
                        <div className={styles.emptyResults}>No current NFL updates available.</div>
                    ) : (
                        newsArticles.map((article, idx) => (
                            <div key={`art-${idx}`} className={styles.newsCard}>
                                <div className={styles.newsHeader}>
                                    <div className={styles.newsSourceGroup}>
                                        <img src={article.icon} alt="" className={styles.newsIcon} onError={(e) => e.target.src = 'brand.png'} />
                                        <span className={styles.newsAuthor}>{article.author}</span>
                                    </div>
                                    <span className={styles.newsDate}>{article.date}</span>
                                </div>
                                <h3 className={styles.newsTitle}>{article.title}</h3>
                                <div 
                                    className={styles.newsBody} 
                                    dangerouslySetInnerHTML={{ __html: article.article }} 
                                />
                            </div>
                        ))
                    )}
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