import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueData, getLeagueTeamManagers, getLeagueRosters, loadPlayers, getNflState } from '../utils/helper';
import { getTeamFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import PlayerModal from '../components/PlayerModal';
import { fetchYahooTransactions } from '../utils/yahooService';
import { fetchESPNTransactions } from '../utils/espnService';
import { isYahooLeagueId, isEspnLeagueId } from '../utils/platformIds';
import { withResolvedPlayerMeta } from '../utils/playerPool';
import { supabase } from '../supabaseClient';
import styles from './Transactions.module.css';
import { resolveImageSrc, onImageError } from '../utils/imageFallback';

const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default function Transactions() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [leagueData, setLeagueData] = useState(null);
    const [teamManagers, setTeamManagers] = useState(null);
    const [playersInfo, setPlayersInfo] = useState({});
    const [transactions, setTransactions] = useState([]);

    // Navigation & Filters
    const [activeTab, setActiveTab] = useState('all'); // 'all', 'trades', 'waivers', 'mine'
    // The signed-in account's own roster_id in this league, so "My
    // Transactions" can filter to it -- resolved the same way Rosters.jsx
    // finds "my team": Yahoo/ESPN flag the requesting account's own roster
    // directly, but Sleeper has no such flag, so it's found by matching this
    // account's stored team_name against the league's current roster names.
    const [myRosterId, setMyRosterId] = useState(null);
    const [activeWeek, setActiveWeek] = useState(1);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [playersByName, setPlayersByName] = useState({});

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
                const [lData, tmData, pData, nflState] = await Promise.all([
                    getLeagueData(sleeperId),
                    getLeagueTeamManagers(sleeperId),
                    loadPlayers(sleeperId),
                    getNflState().catch(() => null)
                ]);

                if (!isMounted) return;
                setLeagueData(lData);
                setTeamManagers(tmData);
                setPlayersInfo(pData.players || pData || {});
                setPlayersByName(pData.playersByName || {});

                // `leagueData` (Sleeper or Yahoo) carries no "current week" field
                // of its own -- the real NFL state is what both platforms are
                // correctly landed on the current week by.
                if (nflState?.season_type === 'regular') setActiveWeek(nflState.display_week || nflState.week || 1);
                else if (nflState?.season_type === 'post') setActiveWeek(18);

                if (isYahooLeagueId(sleeperId) || isEspnLeagueId(sleeperId)) {
                    // Both platforms flag the requesting account's own roster
                    // directly (Yahoo on the roster fetch itself, ESPN resolved
                    // from the connecting account's SWID) -- reliable regardless
                    // of what got stored as this connection's team_name.
                    const rData = await getLeagueRosters(sleeperId, { teamsOnly: true }).catch(() => null);
                    const ownedRoster = Object.values(rData?.rosters || {}).find(r => r.is_owned_by_current_login);
                    if (isMounted && ownedRoster) setMyRosterId(ownedRoster.roster_id);
                } else {
                    const { data: sessionData } = await supabase.auth.getSession();
                    if (sessionData?.session?.user && activeLeague?.id) {
                        const { data: ulData } = await supabase.from('user_leagues').select('team_name').eq('user_id', sessionData.session.user.id).eq('league_id', activeLeague.id).single();
                        const searchName = normalizeStr(ulData?.team_name);
                        if (searchName && searchName !== normalizeStr('commissioner team')) {
                            const rostersMap = tmData.teamManagersMap[tmData.currentSeason] || {};
                            const foundRosterId = Object.keys(rostersMap).find(rId => normalizeStr(rostersMap[rId].team?.name) === searchName);
                            if (isMounted && foundRosterId) setMyRosterId(foundRosterId);
                        }
                    }
                }

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
        const leagueId = activeLeague?.sleeper_league_id;
        if (!leagueId) return;
        let isMounted = true;

        if (isYahooLeagueId(leagueId)) {
            // Yahoo has no per-week transactions endpoint -- the season arrives
            // whole, each entry carrying a timestamp that the adapter turns into
            // a week. So fetch once and filter here.
            fetchYahooTransactions(leagueId)
                .then(({ transactions: all, playerMeta }) => {
                    if (!isMounted) return;
                    // Yahoo names players by id; the shared dictionary only
                    // covers the ones Sleeper's crosswalk knows, so the rest
                    // would render as a bare "Player #40877".
                    if (Object.keys(playerMeta || {}).length) {
                        setPlayersInfo(prev => withResolvedPlayerMeta(prev, playersByName, playerMeta));
                    }
                    setTransactions(all.filter(t => t.leg === activeWeek));
                })
                .catch(err => console.error("Error fetching Yahoo transactions:", err));
        } else if (isEspnLeagueId(leagueId)) {
            // ESPN has no per-week transactions endpoint either -- the whole
            // season arrives in one call, each entry carrying its own
            // scoring-period week, so fetch once and filter here.
            fetchESPNTransactions(leagueId)
                .then(({ transactions: all, playerMeta }) => {
                    if (!isMounted) return;
                    if (Object.keys(playerMeta || {}).length) {
                        setPlayersInfo(prev => withResolvedPlayerMeta(prev, playersByName, playerMeta));
                    }
                    setTransactions(all.filter(t => t.leg === activeWeek));
                })
                .catch(err => console.error("Error fetching ESPN transactions:", err));
        } else {
            fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${activeWeek}`)
                .then(res => res.ok ? res.json() : [])
                .then(data => {
                    if (isMounted) setTransactions(Array.isArray(data) ? data : []);
                })
                .catch(err => console.error("Error fetching transactions:", err));
        }

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
        } else if (activeTab === 'mine') {
            list = list.filter(t =>
                (t.type === 'trade' || t.type === 'waiver' || t.type === 'free_agent')
                && (t.roster_ids || []).some(rId => String(rId) === String(myRosterId))
            );
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
    }, [transactions, activeTab, searchQuery, playersInfo, teamManagers, currentSeason, myRosterId]);

    // Sleeper's image CDN is keyed by SLEEPER ids. In a Yahoo league the id on a
    // transaction is a Yahoo one, so the crosswalked sleeper_id is what makes
    // the headshot resolve; a defense is named by its team instead.
    const getAvatar = (pId, pos, player) => {
        if (pos === 'DEF') {
            const team = String(player?.t || player?.sleeper_id || pId || '').toLowerCase();
            return `https://sleepercdn.com/images/team_logos/nfl/${team}.png`;
        }
        if (!player?.sleeper_id && player?.headshot) return player.headshot;
        return `https://sleepercdn.com/content/nfl/players/thumb/${player?.sleeper_id || pId}.jpg`;
    };

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
                    style={{ backgroundImage: `url(${getAvatar(pId, p.pos, p)}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}
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
                    {myRosterId != null && (
                        <button className={`${styles.navTab} ${activeTab === 'mine' ? styles.activeNavTab : ''}`} onClick={() => setActiveTab('mine')}>My Transactions</button>
                    )}
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
                                                <img src={resolveImageSrc(teamA?.avatar, '/fallback.png')} alt="" className={styles.teamAvatar} referrerPolicy="no-referrer" onError={onImageError(teamA?.avatar, '/fallback.png')} />
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
                                                <img src={resolveImageSrc(teamB?.avatar, '/fallback.png')} alt="" className={styles.teamAvatar} referrerPolicy="no-referrer" onError={onImageError(teamB?.avatar, '/fallback.png')} />
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
                                        <img src={resolveImageSrc(teamMeta?.avatar, '/fallback.png')} alt="" className={styles.teamAvatar} referrerPolicy="no-referrer" onError={onImageError(teamMeta?.avatar, '/fallback.png')} />
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
                        <p>{activeTab === 'mine'
                            ? `No trades or waiver moves of yours found for Week ${activeWeek}.`
                            : `No transactions found for Week ${activeWeek}.`}</p>
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