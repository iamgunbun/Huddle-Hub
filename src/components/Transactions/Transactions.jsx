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

    const displayedTransactions = preview ? transactions.slice(0, 5) : transactions;

    const renderBracketCard = (txn) => {
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
        if (txn.draft_picks) {
            txn.draft_picks.forEach(pick => {
                const rId = pick.owner_id;
                if (!teamMovements[rId]) teamMovements[rId] = { adds: [], drops: [], picks: [] };
                teamMovements[rId].picks.push(pick);
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

                            {moves.picks.map((pick, i) => (
                                <div key={`pick-${i}`} className={styles.assetRow}>
                                    <div className={styles.avatarWrapper}>
                                        <div className={`${styles.avatarImg} ${styles.avatarAdd}`} style={{ background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <i className="material-icons" style={{ color: '#eebf1c' }}>stars</i>
                                        </div>
                                        <div className={`${styles.badge} ${styles.badgeAdd}`}><i className="material-icons">add</i></div>
                                    </div>
                                    <div className={styles.assetText}>
                                        <div className={styles.assetName}>{pick.season} Round {pick.round}</div>
                                        <div className={styles.assetMeta}>Draft Pick</div>
                                    </div>
                                    <div className={styles.txnTimestamp}>{formatDateTime(txn.status_updated)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        });
    };

    if (loading) return <div className={styles.loading}>Loading Activity...</div>;

    return (
        <div className={styles.previewContainer}>
            <h3 className={styles.previewHeader}>Recent Transactions</h3>
            <div className={styles.feed}>
                {displayedTransactions.length === 0 ? (
                    <div className={styles.noData}>No recent transactions found.</div>
                ) : (
                    displayedTransactions.map(txn => renderBracketCard(txn))
                )}
            </div>
            
            {preview && (
                <button className={styles.viewAllBtn} onClick={() => navigate('/transactions')}>
                    View All Transactions
                </button>
            )}
        </div>
    );
}