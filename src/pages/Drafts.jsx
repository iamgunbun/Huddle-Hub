import React, { useState, useEffect } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers, loadPlayers } from '../utils/helper';
import styles from './Drafts.module.css';

export default function Drafts() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    
    const [draftsList, setDraftsList] = useState([]);
    const [selectedDraftId, setSelectedDraftId] = useState('all'); 
    const [draftsDataMap, setDraftsDataMap] = useState({}); 
    const [teamManagers, setTeamManagers] = useState(null);
    const [playersMap, setPlayersMap] = useState({});

    const getPosColor = (pos) => {
        const map = { QB: '#3b82f6', RB: '#ef4444', WR: '#22c55e', TE: '#f59e0b', K: '#eab308', DEF: '#a855f7' };
        return map[pos] || '#64748b';
    };

    // Safely handles defenses and transparent rookie PNGs by layering a fallback behind it
    const getAvatar = (playerId, playerMeta) => {
        if (!playerMeta) return `url(https://sleepercdn.com/images/v2/icons/player_default.webp)`;
        if (playerMeta.pos === 'DEF') return `url(https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png)`;
        return `url(https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg), url(https://sleepercdn.com/images/v2/icons/player_default.webp)`;
    };

    useEffect(() => {
        const loadHistory = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [tmData, pData] = await Promise.all([
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    loadPlayers()
                ]);
                setTeamManagers(tmData);
                setPlayersMap(pData?.players || {});

                let curId = activeLeague.sleeper_league_id;
                let allDrafts = [];
                while (curId && curId !== "0" && curId !== 0) {
                    const res = await fetch(`https://api.sleeper.app/v1/league/${curId}/drafts`);
                    if (!res.ok) break;
                    const drafts = await res.json();
                    allDrafts.push(...drafts);
                    
                    const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${curId}`);
                    const leagueData = await leagueRes.json();
                    curId = leagueData.previous_league_id;
                }
                setDraftsList(allDrafts.sort((a,b) => b.season - a.season));
            } catch (e) { console.error(e); } finally { setLoading(false); }
        };
        loadHistory();
    }, [activeLeague]);

    useEffect(() => {
        const fetchAllPicks = async () => {
            const map = {};
            await Promise.all(draftsList.map(async (d) => {
                const res = await fetch(`https://api.sleeper.app/v1/draft/${d.draft_id}/picks`);
                if (res.ok) {
                    const picks = await res.json();
                    map[d.draft_id] = picks.sort((a, b) => a.round - b.round || a.pick_no - b.pick_no);
                }
            }));
            setDraftsDataMap(map);
        };
        fetchAllPicks();
    }, [draftsList]);

    const renderDraftBoard = (draft) => {
        const picks = draftsDataMap[draft.draft_id] || [];
        const groups = {};
        let maxSlot = 0;
        
        picks.forEach(p => {
            const r = parseInt(p.round);
            if (!groups[r]) groups[r] = [];
            groups[r].push(p);
            if (p.draft_slot > maxSlot) maxSlot = p.draft_slot;
        });

        if (maxSlot === 0) maxSlot = draft.settings?.teams || 10;
        const slots = Array.from({ length: maxSlot }, (_, i) => i + 1);

        const draftYear = draft.season;
        let yearRosters = teamManagers?.teamManagersMap[draftYear];
        if (!yearRosters || Object.keys(yearRosters).length === 0) {
             yearRosters = teamManagers?.teamManagersMap[teamManagers.currentSeason] || {};
        }

        const getOwnerForSlot = (slot) => {
            if (draft.slot_to_roster_id && draft.slot_to_roster_id[slot]) {
                const rId = draft.slot_to_roster_id[slot];
                if (yearRosters[rId]) return { roster_id: parseInt(rId), ...yearRosters[rId] };
            }
            if (draft.draft_order) {
                const userId = Object.keys(draft.draft_order).find(uid => draft.draft_order[uid] === slot);
                if (userId) {
                    const rId = Object.keys(yearRosters).find(id => yearRosters[id].managers?.includes(userId));
                    if (rId) return { roster_id: parseInt(rId), ...yearRosters[rId] };
                }
            }
            const r1Pick = picks.find(p => parseInt(p.round) === 1 && p.draft_slot === slot);
            if (r1Pick && yearRosters[r1Pick.roster_id]) {
                return { roster_id: parseInt(r1Pick.roster_id), ...yearRosters[r1Pick.roster_id] };
            }
            return { roster_id: 0, team: { name: `Slot ${slot}`, avatar: 'https://sleepercdn.com/images/v2/icons/player_default.webp' } };
        };

        const headerOwners = slots.map(slot => getOwnerForSlot(slot));

        return (
            <div key={draft.draft_id} className={styles.draftSection}>
                <h2 className={styles.sectionHeader}>{draft.season} {draft.metadata?.name || 'Draft'}</h2>
                
                <div className={styles.boardWrapper}>
                    {/* Header Row */}
                    <div className={styles.rowLayout}>
                        <div className={styles.roundLabelPlaceholder}></div>
                        {headerOwners.map((owner, idx) => (
                            <div key={`header-${idx}`} className={styles.headerCard}>
                                <img src={owner.team.avatar} alt="Owner" className={styles.ownerAvatar} />
                                <span className={styles.ownerName}>{owner.team.name}</span>
                            </div>
                        ))}
                    </div>

                    {/* Picks Rows */}
                    {Object.keys(groups).sort((a, b) => a - b).map(round => (
                        <div key={`${draft.draft_id}-R${round}`} className={styles.rowLayout}>
                            <div className={styles.roundLabel}>R{round}</div>
                            
                            {slots.map(slot => {
                                const pick = groups[round].find(p => p.draft_slot === slot);
                                if (!pick) return <div key={`empty-${round}-${slot}`} className={styles.emptyPick}></div>;
                                
                                const player = playersMap[pick.player_id];
                                const slotOwner = headerOwners[slot - 1];
                                
                                const isTraded = pick.roster_id && slotOwner.roster_id !== 0 && parseInt(pick.roster_id) !== slotOwner.roster_id;
                                let pickOwnerName = "Unknown";
                                if (isTraded && yearRosters[pick.roster_id]) {
                                    pickOwnerName = yearRosters[pick.roster_id].team.name;
                                }
                                
                                return (
                                    <div key={pick.pick_no} className={styles.pickCard} style={{ borderLeftColor: getPosColor(player?.pos) }}>
                                        <div className={styles.pickHeader}>
                                            <span className={styles.pickNumber}>{round}.{pick.pick_no.toString().padStart(2, '0')}</span>
                                        </div>
                                        <div className={styles.pInfo}>
                                            {/* Replaced standard image tag with background div for fallback processing */}
                                            <div className={styles.pIcon} style={{ backgroundImage: getAvatar(pick.player_id, player) }}></div>
                                            
                                            <div className={styles.pText}>
                                                <div className={styles.pName}>{player?.fn || 'Unknown'} {player?.ln || ''}</div>
                                                <div className={styles.pMeta}>{player?.pos || 'BN'} • {player?.t || 'FA'}</div>
                                            </div>
                                        </div>
                                        {isTraded && <div className={styles.tradeTag}>Pck: {pickOwnerName}</div>}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    if (loading) return <div className={styles.loading}>Loading Draft Board...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.headerControls}>
                <h1 className={styles.headerTitle}>Draft Room</h1>
                <select className={styles.dropdown} value={selectedDraftId} onChange={(e) => setSelectedDraftId(e.target.value)}>
                    <option value="all">All Drafts</option>
                    {draftsList.map(d => (
                        <option key={d.draft_id} value={d.draft_id}>{d.season} {d.metadata?.name || 'Main Draft'}</option>
                    ))}
                </select>
            </div>

            {selectedDraftId === 'all' 
                ? draftsList.map(d => renderDraftBoard(d))
                : (draftsList.find(d => d.draft_id === selectedDraftId) ? renderDraftBoard(draftsList.find(d => d.draft_id === selectedDraftId)) : null)
            }
        </div>
    );
}