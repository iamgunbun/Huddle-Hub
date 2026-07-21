import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueData, getLeagueTeamManagers, loadPlayers } from '../utils/helper';
import { getTeamFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import PlayerModal from '../components/PlayerModal';
import styles from './Transactions.module.css';

export default function Transactions() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [leagueData, setLeagueData] = useState(null);
    const [teamManagers, setTeamManagers] = useState(null);
    const [playersInfo, setPlayersInfo] = useState({});
    const [transactions, setTransactions] = useState([]);

    // Navigation & Filters
    const [activeTab, setActiveTab] = useState('all'); // 'all', 'trades', 'waivers'
    const [activeWeek, setActiveWeek] = useState(1);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    const getPlayerObj = (pId) => {
        if (!pId || pId === "0") return null;
        return playersInfo[pId] || playersInfo[String(pId)] || null;
    };

    // 1. Initial Load
    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const sleeperId = activeLeague.sleeper_league_id;
                const [lData, tmData, pData] = await Promise.all([
                    getLeagueData(sleeperId),
                    getLeagueTeamManagers(sleeperId),
                    loadPlayers()
                ]);

                if (!isMounted) return;
                setLeagueData(lData);
                setTeamManagers(tmData);
                setPlayersInfo(pData.players || pData || {});
                if (lData?.display_week) setActiveWeek(lData.display_week);

            } catch (e) {
                console.error("Error loading base transaction data:", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    // 2. Fetch Transactions for Selected Week
    useEffect(() => {
        if (!activeLeague?.sleeper_league_id) return;
        let isMounted = true;

        fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}/transactions/${activeWeek}`)
            .then(res => res.ok ? res.json() : [])
            .then(data => {
                if (isMounted) setTransactions(Array.isArray(data) ? data : []);
            })
            .catch(err => console.error("Error fetching transactions:", err));

        return () => { isMounted = false; };
    }, [activeLeague, activeWeek]);

    const currentSeason = teamManagers?.currentSeason;

    // Filter Transactions
    const filteredTransactions = useMemo(() => {
        let list = [...transactions];

        if (activeTab === 'trades') {
            list = list.filter(t => t.type === 'trade');
        } else if (activeTab === 'waivers') {
            list = list.filter(t => t.type === 'waiver' || t.type === 'free_agent');
        }

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter(t => {
                const playerIds = [
                    ...Object.keys(t.adds || {}),
                    ...Object.keys(t.drops || {})
                ];
                const matchesPlayer = playerIds.some(pId => {
                    const p = getPlayerObj(pId);
                    if (!p) return false;
                    const fn = (p.fn || p.first_name || '').toLowerCase();
                    const ln = (p.ln || p.last_name || '').toLowerCase();
                    return fn.includes(q) || ln.includes(q) || `${fn} ${ln}`.includes(q);
                });

                const matchesTeam = (t.roster_ids || []).some(rId => {
                    const teamMeta = getTeamFromTeamManagers(teamManagers, rId, currentSeason);
                    return (teamMeta?.name || '').toLowerCase().includes(q);
                });

                return matchesPlayer || matchesTeam;
            });
        }

        return list.sort((a, b) => b.status_updated - a.status_updated);
    }, [transactions, activeTab, searchQuery, playersInfo, teamManagers, currentSeason]);

    const getAvatar = (pId, pos) => pos === 'DEF' 
        ? `https://sleepercdn.com/images/team_logos/nfl/${String(pId).toLowerCase()}.png` 
        : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;

    const formatTimestamp = (ts) => {
        if (!ts) return '';
        const date = new Date(ts);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const renderCompactPlayer = (pId, actionType) => {
        const p = getPlayerObj(pId);
        if (!p) return <div key={pId} className={styles.playerMiniRow}>Player #{pId}</div>;

        const isAdd = actionType === 'add';
        const firstName = p.fn || p.first_name || '';
        const lastName = p.ln || p.last_name || '';
        const teamDisplay = p.t || p.team;

        return (
            <div key={pId} className={styles.playerMiniRow} onClick={() => setSelectedPlayer(p)}>
                <span className={isAdd ? styles.addBadge : styles.dropBadge}>
                    <i className="material-icons">{isAdd ? 'add' : 'remove'}</i>
                </span>
                <div 
                    className={styles.miniAvatar} 
                    style={{ backgroundImage: `url(${getAvatar(pId, p.pos)}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}
                ></div>
                <div className={styles.miniMeta}>
                    <span className={styles.miniName}>{firstName.charAt(0)}. {lastName}</span>
                    <span className={styles.miniSub}>
                        {p.pos} {teamDisplay && teamDisplay !== 'FA' ? `• ${teamDisplay}` : ''}
                    </span>
                </div>
            </div>
        );
    };

    if (loading) return <div className={styles.loading}>Loading Transactions...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.topHeader}>
                <button className={styles.searchToggleBtn} onClick={() => setIsSearchOpen(!isSearchOpen)}>
                    <i className="material-icons">{isSearchOpen ? 'close' : 'search'}</i>
                </button>
                <div className={styles.navTabs}>
                    <button className={`${styles.navTab} ${activeTab === 'all' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('all')}>All</button>
                    <button className={`${styles.navTab} ${activeTab === 'trades' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('trades')}>Trades</button>
                    <button className={`${styles.navTab} ${activeTab === 'waivers' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('waivers')}>Waivers</button>
                </div>
                <select 
                    className={styles.weekDropdown} 
                    value={activeWeek} 
                    onChange={(e) => setActiveWeek(parseInt(e.target.value))}
                >
                    {[...Array(18).keys()].map(i => (
                        <option key={i+1} value={i+1}>Wk {i+1}</option>
                    ))}
                </select>
            </div>

            {isSearchOpen && (
                <div className={styles.searchContainer}>
                    <input 
                        type="text" 
                        placeholder="Search manager or player..." 
                        className={styles.searchInput}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                </div>
            )}

            <div className={styles.txFeed}>
                {filteredTransactions.length > 0 ? (
                    filteredTransactions.map((tx) => {
                        const isTrade = tx.type === 'trade';
                        const isWaiver = tx.type === 'waiver';
                        const isFA = tx.type === 'free_agent';

                        // TRADE CARD RENDER
                        if (isTrade) {
                            const rosterIds = tx.roster_ids || [];
                            const teamA = getTeamFromTeamManagers(teamManagers, rosterIds[0], currentSeason);
                            const teamB = getTeamFromTeamManagers(teamManagers, rosterIds[1], currentSeason);

                            const teamAAdds = [];
                            const teamBAdds = [];
                            
                            Object.entries(tx.adds || {}).forEach(([pId, rId]) => {
                                if (rId === rosterIds[0]) teamAAdds.push(pId);
                                else if (rId === rosterIds[1]) teamBAdds.push(pId);
                            });

                            const teamAPicks = (tx.draft_picks || []).filter(p => p.owner_id === rosterIds[0]);
                            const teamBPicks = (tx.draft_picks || []).filter(p => p.owner_id === rosterIds[1]);

                            return (
                                <div key={tx.transaction_id} className={styles.txCardTrade}>
                                    <div className={styles.txCardHeader}>
                                        <span className={styles.tradeTag}>TRADE</span>
                                        <span className={styles.txTime}>{formatTimestamp(tx.status_updated)}</span>
                                    </div>

                                    <div className={styles.tradeGrid}>
                                        <div className={styles.tradeColumn}>
                                            <div className={styles.teamHeaderRow}>
                                                <img src={teamA?.avatar || 'https://sleepercdn.com/images/v2/icons/league_default.webp'} alt="" className={styles.teamAvatar} />
                                                <span className={styles.teamName}>{teamA?.name || 'Team 1'}</span>
                                            </div>
                                            <div className={styles.receivedLabel}>Received:</div>
                                            <div className={styles.assetsList}>
                                                {teamAAdds.map(pId => renderCompactPlayer(pId, 'add'))}
                                                {teamAPicks.map((pick, idx) => (
                                                    <div key={idx} className={styles.pickBadge}>
                                                        <i className="material-icons">confirmation_number</i>
                                                        <span>{pick.season} R{pick.round}</span>
                                                    </div>
                                                ))}
                                                {teamAAdds.length === 0 && teamAPicks.length === 0 && (
                                                    <span className={styles.noneText}>Nothing</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className={styles.tradeDivider}>
                                            <i className="material-icons">sync</i>
                                        </div>

                                        <div className={styles.tradeColumn}>
                                            <div className={styles.teamHeaderRow}>
                                                <img src={teamB?.avatar || 'https://sleepercdn.com/images/v2/icons/league_default.webp'} alt="" className={styles.teamAvatar} />
                                                <span className={styles.teamName}>{teamB?.name || 'Team 2'}</span>
                                            </div>
                                            <div className={styles.receivedLabel}>Received:</div>
                                            <div className={styles.assetsList}>
                                                {teamBAdds.map(pId => renderCompactPlayer(pId, 'add'))}
                                                {teamBPicks.map((pick, idx) => (
                                                    <div key={idx} className={styles.pickBadge}>
                                                        <i className="material-icons">confirmation_number</i>
                                                        <span>{pick.season} R{pick.round}</span>
                                                    </div>
                                                ))}
                                                {teamBAdds.length === 0 && teamBPicks.length === 0 && (
                                                    <span className={styles.noneText}>Nothing</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // WAIVER / FA CARD RENDER
                        const rosterId = (tx.roster_ids || [])[0];
                        const teamMeta = getTeamFromTeamManagers(teamManagers, rosterId, currentSeason);
                        const adds = Object.keys(tx.adds || {});
                        const drops = Object.keys(tx.drops || {});

                        return (
                            <div key={tx.transaction_id} className={styles.txCard}>
                                <div className={styles.txCardHeader}>
                                    <div className={styles.headerLeftGroup}>
                                        {(isWaiver || isFA) && (
                                            <span className={styles.waiverTag}>
                                                WAIVER
                                            </span>
                                        )}
                                        {tx.settings?.waiver_bid !== undefined && tx.settings?.waiver_bid > 0 && (
                                            <span className={styles.faabBadge}>${tx.settings.waiver_bid} FAAB</span>
                                        )}
                                    </div>
                                    <span className={styles.txTime}>{formatTimestamp(tx.status_updated)}</span>
                                </div>

                                <div className={styles.waiverBody}>
                                    <div className={styles.teamHeaderRowSingle}>
                                        <img src={teamMeta?.avatar || 'https://sleepercdn.com/images/v2/icons/league_default.webp'} alt="" className={styles.teamAvatar} />
                                        <span className={styles.teamName}>{teamMeta?.name || 'Manager'}</span>
                                    </div>

                                    <div className={styles.actionList}>
                                        {adds.map(pId => renderCompactPlayer(pId, 'add'))}
                                        {drops.map(pId => renderCompactPlayer(pId, 'drop'))}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className={styles.emptyState}>
                        <i className="material-icons">swap_horiz</i>
                        <p>No transactions found for Week {activeWeek}.</p>
                    </div>
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