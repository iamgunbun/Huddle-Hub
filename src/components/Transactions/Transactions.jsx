import React, { useState, useEffect } from 'react';
import { useLeague } from '../../context/LeagueContext';
import { loadPlayers, getLeagueTeamManagers } from '../../utils/helper';
import { useNavigate } from 'react-router-dom';
import styles from './Transactions.module.css';

export default function Transactions({ preview = false }) {
    const { activeLeague } = useLeague();
    const navigate = useNavigate();
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [playersMap, setPlayersMap] = useState({});
    const [teamManagers, setTeamManagers] = useState(null);
    
    // State for the full page view
    const [filter, setFilter] = useState('all'); 
    const [visibleCount, setVisibleCount] = useState(30);

    useEffect(() => {
        const fetchTransactions = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [pData, tmData] = await Promise.all([
                    loadPlayers(),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id)
                ]);
                setPlayersMap(pData?.players || {});
                setTeamManagers(tmData);

                let allTxns = [];
                for (let i = 1; i <= 18; i++) {
                    const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}/transactions/${i}`);
                    if (res.ok) {
                        const data = await res.json();
                        allTxns = [...allTxns, ...data];
                    }
                }
                
                const validTxns = allTxns
                    .filter(t => t.status === 'complete')
                    .sort((a, b) => b.status_updated - a.status_updated);
                    
                setTransactions(validTxns);
            } catch (err) {
                console.error("Failed to load transactions:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchTransactions();
    }, [activeLeague]);

    const handleFilterChange = (type) => {
        setFilter(type);
        setVisibleCount(30);
    };

    const getTeamInfo = (rosterId) => {
        if (!teamManagers || !teamManagers.teamManagersMap) return { name: 'Unknown', avatar: '' };
        const roster = teamManagers.teamManagersMap[teamManagers.currentSeason]?.[rosterId];
        if (roster && roster.team) {
            return { name: roster.team.name };
        }
        return { name: `Team ${rosterId}` };
    };

    const formatDateTime = (timestamp) => {
        const date = new Date(timestamp);
        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        const timeOptions = { hour: 'numeric', minute: '2-digit' };
        return `${date.toLocaleDateString('en-US', options)}, ${date.toLocaleTimeString('en-US', timeOptions)}`;
    };

    const renderWaiverCard = (txn) => {
        const teamMovements = {};

        if (txn.adds) {
            Object.entries(txn.adds).forEach(([pId, rId]) => {
                if (!teamMovements[rId]) teamMovements[rId] = { adds: [], drops: [], picks: [] };
                teamMovements[rId].adds.push(pId);
            });
        }
        if (txn.drops) {
            Object.entries(txn.drops).forEach(([pId, rId]) => {
                if (!teamMovements[rId]) teamMovements[rId] = { adds: [], drops: [], picks: [] };
                teamMovements[rId].drops.push(pId);
            });
        }

        return Object.keys(teamMovements).map((rId, index) => {
            const team = getTeamInfo(rId);
            const moves = teamMovements[rId];
            
            return (
                <div key={`${txn.transaction_id}-${rId}-${index}`} className={styles.bracketCard}>
                    <div className={styles.bracketDecor}></div>
                    
                    <div className={styles.cardMain}>
                        <div className={styles.teamNameLabel}>{team.name}</div>
                        
                        <div className={styles.assetContainer}>
                            {moves.adds.map(pId => {
                                const player = playersMap[pId];
                                const isDef = player?.pos === 'DEF';
                                const avatarUrl = isDef ? `https://sleepercdn.com/images/team_logos/nfl/${pId.toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;
                                const fallback = 'https://sleepercdn.com/images/v2/icons/player_default.webp';
                                
                                return (
                                    <div key={`add-${pId}`} className={styles.assetRow}>
                                        <div className={styles.avatarWrapper}>
                                            <div className={`${styles.avatarImg} ${styles.avatarAdd}`} style={{ backgroundImage: `url(${avatarUrl}), url(${fallback})` }}></div>
                                            <div className={`${styles.badge} ${styles.badgeAdd}`}><i className="material-icons">add</i></div>
                                        </div>
                                        <div className={styles.assetText}>
                                            <div className={styles.assetName}>{player?.fn} {player?.ln}</div>
                                            <div className={styles.assetMeta}>{player?.pos} - {player?.t || 'FA'}</div>
                                        </div>
                                        <div className={styles.txnTimestamp}>{formatDateTime(txn.status_updated)}</div>
                                    </div>
                                );
                            })}

                            {moves.drops.map(pId => {
                                const player = playersMap[pId];
                                const isDef = player?.pos === 'DEF';
                                const avatarUrl = isDef ? `https://sleepercdn.com/images/team_logos/nfl/${pId.toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;
                                const fallback = 'https://sleepercdn.com/images/v2/icons/player_default.webp';
                                
                                return (
                                    <div key={`drop-${pId}`} className={styles.assetRow}>
                                        <div className={styles.avatarWrapper}>
                                            <div className={`${styles.avatarImg} ${styles.avatarDrop}`} style={{ backgroundImage: `url(${avatarUrl}), url(${fallback})` }}></div>
                                            <div className={`${styles.badge} ${styles.badgeDrop}`}><i className="material-icons">remove</i></div>
                                        </div>
                                        <div className={styles.assetText}>
                                            <div className={styles.assetName}>{player?.fn} {player?.ln}</div>
                                            <div className={styles.assetMeta}>{player?.pos} - {player?.t || 'FA'}</div>
                                        </div>
                                        <div className={styles.txnTimestamp}>{formatDateTime(txn.status_updated)}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            );
        });
    };

    // The grouped trade card logic
    const renderTradeCard = (txn) => {
        return (
            <div key={txn.transaction_id} className={styles.bracketCard}>
                <div className={styles.bracketDecor} style={{ background: '#eebf1c' }}></div>
                <div className={styles.cardMain}>
                    <div className={styles.teamNameLabel} style={{ color: '#eebf1c', marginBottom: '10px' }}>TRADE</div>
                    
                    {txn.roster_ids.map((rId, index) => {
                        const team = getTeamInfo(rId);
                        
                        const addedPlayers = Object.keys(txn.adds || {}).filter(pId => txn.adds[pId] === rId);
                        const addedPicks = (txn.draft_picks || []).filter(pick => pick.owner_id === rId);

                        if (addedPlayers.length === 0 && addedPicks.length === 0) return null;

                        return (
                            <div key={rId} style={{ marginTop: index > 0 ? '15px' : '0' }}>
                                <div className={styles.teamNameLabel} style={{ fontSize: '0.85em', color: '#94a3b8', marginBottom: '8px' }}>
                                    {team.name} Received:
                                </div>
                                <div className={styles.assetContainer}>
                                    
                                    {addedPlayers.map(pId => {
                                        const player = playersMap[pId];
                                        const isDef = player?.pos === 'DEF';
                                        const avatarUrl = isDef ? `https://sleepercdn.com/images/team_logos/nfl/${pId.toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;
                                        const fallback = 'https://sleepercdn.com/images/v2/icons/player_default.webp';
                                        
                                        return (
                                            <div key={`trade-add-${pId}`} className={styles.assetRow}>
                                                <div className={styles.avatarWrapper}>
                                                    <div className={`${styles.avatarImg} ${styles.avatarAdd}`} style={{ backgroundImage: `url(${avatarUrl}), url(${fallback})` }}></div>
                                                </div>
                                                <div className={styles.assetText}>
                                                    <div className={styles.assetName}>{player?.fn} {player?.ln}</div>
                                                    <div className={styles.assetMeta}>{player?.pos} - {player?.t || 'FA'}</div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {addedPicks.map((pick, i) => (
                                        <div key={`trade-pick-${i}`} className={styles.assetRow}>
                                            <div className={styles.avatarWrapper}>
                                                <div className={`${styles.avatarImg} ${styles.avatarAdd}`} style={{ background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <i className="material-icons" style={{ color: '#eebf1c', fontSize: '18px' }}>stars</i>
                                                </div>
                                            </div>
                                            <div className={styles.assetText}>
                                                <div className={styles.assetName}>{pick.season} Round {pick.round}</div>
                                                <div className={styles.assetMeta}>Draft Pick</div>
                                            </div>
                                        </div>
                                    ))}

                                </div>
                            </div>
                        );
                    })}
                    <div className={styles.txnTimestamp} style={{ marginTop: '15px' }}>{formatDateTime(txn.status_updated)}</div>
                </div>
            </div>
        );
    };

    if (loading) return <div className={styles.loading}>Loading Transactions...</div>;

    // ----- HOME PAGE PREVIEW RENDER -----
    if (preview) {
        const recentWaivers = transactions.filter(t => t.type === 'waiver' || t.type === 'free_agent').slice(0, 3);
        const recentTrades = transactions.filter(t => t.type === 'trade').slice(0, 3);

        return (
            <div className={styles.previewContainer}>
                <h3 className={styles.previewHeader}>Recent Waivers</h3>
                <div className={styles.feed} style={{ marginBottom: '30px' }}>
                    {recentWaivers.length === 0 ? (
                        <div className={styles.noData}>No recent waivers found.</div>
                    ) : (
                        recentWaivers.map(txn => renderWaiverCard(txn))
                    )}
                </div>

                <h3 className={styles.previewHeader}>Recent Trades</h3>
                <div className={styles.feed}>
                    {recentTrades.length === 0 ? (
                        <div className={styles.noData}>No recent trades found.</div>
                    ) : (
                        recentTrades.map(txn => renderTradeCard(txn))
                    )}
                </div>
                
                <button className={styles.viewAllBtn} onClick={() => navigate('/transactions')}>
                    View All Transactions
                </button>
            </div>
        );
    }

    // ----- FULL PAGE RENDER -----
    const filteredTxns = transactions.filter(txn => {
        if (filter === 'trade') return txn.type === 'trade';
        if (filter === 'waiver') return txn.type === 'waiver' || txn.type === 'free_agent';
        return true; // 'all'
    });

    const displayedTransactions = filteredTxns.slice(0, visibleCount);

    return (
        <div className={styles.pageContainer}>
            <h1 className={styles.pageTitle} style={{ textAlign: 'center', color: '#f8fafc', marginBottom: '20px', letterSpacing: '2px' }}>TRANSACTIONS LOG</h1>
            
            <div className={styles.filterToggle} style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '40px' }}>
                <button 
                    style={{ padding: '8px 20px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontWeight: 'bold', background: filter === 'all' ? '#eebf1c' : 'transparent', color: filter === 'all' ? '#000' : '#94a3b8' }}
                    onClick={() => handleFilterChange('all')}
                >
                    ALL
                </button>
                <button 
                    style={{ padding: '8px 20px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontWeight: 'bold', background: filter === 'trade' ? '#eebf1c' : 'transparent', color: filter === 'trade' ? '#000' : '#94a3b8' }}
                    onClick={() => handleFilterChange('trade')}
                >
                    TRADES
                </button>
                <button 
                    style={{ padding: '8px 20px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontWeight: 'bold', background: filter === 'waivers' ? '#eebf1c' : 'transparent', color: filter === 'waivers' ? '#000' : '#94a3b8' }}
                    onClick={() => handleFilterChange('waiver')}
                >
                    WAIVERS
                </button>
            </div>

            <div className={styles.feed}>
                {displayedTransactions.length === 0 ? (
                    <div className={styles.noData}>No transactions found for this category.</div>
                ) : (
                    displayedTransactions.map(txn => {
                        if (txn.type === 'trade') return renderTradeCard(txn);
                        return renderWaiverCard(txn);
                    })
                )}
            </div>

            {visibleCount < filteredTxns.length && (
                <div className={styles.loadMoreWrapper} style={{ display: 'flex', justifyContent: 'center', marginTop: '30px' }}>
                    <button 
                        className={styles.loadMoreBtn} 
                        onClick={() => setVisibleCount(prev => prev + 30)}
                        style={{ background: 'transparent', color: '#eebf1c', border: '2px solid #eebf1c', padding: '10px 30px', borderRadius: '24px', fontWeight: '700', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                        Load More
                    </button>
                </div>
            )}
        </div>
    );
}