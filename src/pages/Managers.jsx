import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers, getAwards, getLeagueRecords, loadPlayers, getLeagueRosters } from '../utils/helper';
import { syncActiveLeague } from '../utils/leagueInfo';
import styles from './Managers.module.css';

const parseAiResponse = (rawText) => {
    try {
        return JSON.parse(rawText);
    } catch (e) {
        let clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        while (clean.endsWith('}')) {
            try {
                return JSON.parse(clean);
            } catch (err) {
                clean = clean.slice(0, -1).trim();
            }
        }
        throw new Error("Catastrophic JSON format error.");
    }
};

export default function Managers() {
    const { activeLeague } = useLeague();
    const [searchParams, setSearchParams] = useSearchParams();
    
    const [loading, setLoading] = useState(true);
    const [mergedManagers, setMergedManagers] = useState([]);
    const [myManagerId, setMyManagerId] = useState(null);
    
    const [evaluations, setEvaluations] = useState({});
    const [regenStatus, setRegenStatus] = useState({});
    const [evalLoading, setEvalLoading] = useState(false);
    const [uiErrorMessage, setUiErrorMessage] = useState(null);
          
    const selectedManagerId = searchParams.get('manager');
    const selectedManager = mergedManagers.find(m => m.managerId === selectedManagerId);
    
    const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    useEffect(() => {
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                if (syncActiveLeague) {
                    syncActiveLeague(activeLeague.sleeper_league_id, activeLeague.league_name);
                }
                
                const [tmData, podiumsData, recordsData] = await Promise.all([
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    getAwards(true, activeLeague.sleeper_league_id),
                    getLeagueRecords(true, activeLeague.sleeper_league_id)
                ]);

                let foundMyManagerId = null;
                const { data: sessionData } = await supabase.auth.getSession();
                const { data: ulData } = await supabase.from('user_leagues').select('user_id, team_name').eq('league_id', activeLeague.id);
                const userIds = ulData?.map(u => u.user_id) || [];
                const { data: profilesData } = await supabase.from('profiles').select('id, favorite_team').in('id', userIds);
                
                const dbUsers = ulData?.map(ul => ({
                    ...ul,
                    favorite_team: profilesData?.find(p => p.id === ul.user_id)?.favorite_team
                }));

                if (sessionData?.session?.user) {
                    const myUlRecord = dbUsers?.find(u => u.user_id === sessionData.session.user.id);
                    const searchName = normalizeStr(myUlRecord?.team_name);
                    
                    if (searchName && searchName !== normalizeStr('commissioner team')) {
                        for (const [rId, rData] of Object.entries(tmData.teamManagersMap[tmData.currentSeason] || {})) {
                            if (normalizeStr(rData.team?.name) === searchName) {
                                foundMyManagerId = rData.managers?.[0];
                                break;
                            }
                        }
                    }
                }
                setMyManagerId(foundMyManagerId);

                const currentSeason = tmData.currentSeason;
                const activeRosters = tmData.teamManagersMap[currentSeason] || {};
                const formatted = [];

                for (const [rId, rData] of Object.entries(activeRosters)) {
                    const primaryManagerId = rData.managers?.[0];
                    if (!primaryManagerId) continue;
                    const sleeperUser = tmData.users[primaryManagerId] || {};
                    const teamName = rData.team.name;
                    
                    let supaUser = dbUsers?.find(u => {
                        const dbName = normalizeStr(u.team_name);
                        return dbName === normalizeStr(teamName) || dbName === normalizeStr(sleeperUser.display_name);
                    });

                    const rings = [];
                    const runnerUps = [];
                    const toiletBowls = [];
                    (podiumsData || []).forEach(p => {
                        const yearRosters = tmData.teamManagersMap[p.year] || {};
                        if (yearRosters[p.champion]?.managers?.includes(primaryManagerId)) rings.push(p.year);
                        if (yearRosters[p.second]?.managers?.includes(primaryManagerId)) runnerUps.push(p.year);
                        if (yearRosters[p.toilet]?.managers?.includes(primaryManagerId)) toiletBowls.push(p.year);
                    });

                    const managerRecord = recordsData?.regularSeasonData?.leagueManagerRecords?.[primaryManagerId] || { wins: 0, losses: 0, ties: 0 };

                    formatted.push({
                        rosterId: rId,
                        managerId: primaryManagerId,
                        teamName: teamName,
                        teamAvatar: rData.team.avatar,
                        username: sleeperUser.display_name || 'Unknown Manager',
                        favoriteTeam: supaUser?.favorite_team || null,
                        rings: rings,
                        runnerUps: runnerUps,
                        toiletBowls: toiletBowls,
                        record: managerRecord
                    });
                }
                formatted.sort((a, b) => b.rings.length - a.rings.length);
                setMergedManagers(formatted);
            } catch (e) {
                console.error("Failed to load managers layout:", e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [activeLeague]);

    const runEvaluation = async (manager, forceRegenerate = false, autoCheckOnly = false) => {
        setEvalLoading(true);
        setUiErrorMessage(null);
        try {
            const currentYear = new Date().getFullYear();
            
            const { data: existing } = await supabase
                .from('ai_evaluations')
                .select('*')
                .eq('manager_id', manager.managerId)
                .eq('league_id', activeLeague.sleeper_league_id)
                .eq('year', currentYear)
                .maybeSingle();

            if (existing && !forceRegenerate) {
                try { 
                    const parsed = parseAiResponse(existing.evaluation_text);
                    setEvaluations(prev => ({ ...prev, [manager.managerId]: parsed }));
                    setRegenStatus(prev => ({ ...prev, [manager.managerId]: existing.regenerated }));
                } catch (e) { 
                    console.error("Cache Parsing Failed:", e);
                    setUiErrorMessage("The cached evaluation was corrupted. Please regenerate.");
                }
                setEvalLoading(false);
                return;
            }

            if (existing && forceRegenerate && existing.regenerated) {
                alert("This manager's evaluation has already been manually regenerated this season.");
                setEvalLoading(false);
                return;
            }

            if (autoCheckOnly) {
                setEvalLoading(false);
                return; 
            }

            setEvalLoading(true);
            
            const pData = await loadPlayers();
            const rData = await getLeagueRosters(activeLeague.sleeper_league_id);
            const playersMap = pData?.players || {};
            
            const targetRoster = Object.values(rData?.rosters || {}).find(
                r => r.owner_id === manager.managerId || r.co_owners?.includes(manager.managerId)
            );
            
            const mappedPlayerStrings = (targetRoster?.players || []).map(pId => {
                const player = playersMap[pId];
                return player ? `${player.fn} ${player.ln} (${player.pos} - ${player.t})` : 'Unknown Player';
            });

            const response = await fetch('/api/evaluate-manager', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    managerId: manager.managerId, 
                    leagueId: activeLeague.sleeper_league_id, 
                    teamName: manager.teamName,
                    currentRosterPlayers: mappedPlayerStrings
                }),
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({}));
                throw new Error(errJson.error || `Server API error ${response.status}`);
            }

            const data = await response.json();
            if (!data.evaluation) throw new Error("API completely executed but returned an empty response block.");
            
            let newEvalParsed = parseAiResponse(data.evaluation); 

            if (existing && forceRegenerate) {
                await supabase.from('ai_evaluations').update({ evaluation_text: data.evaluation, regenerated: true }).eq('id', existing.id);
                setRegenStatus(prev => ({ ...prev, [manager.managerId]: true }));
            } else if (!existing) {
                await supabase.from('ai_evaluations').insert({
                    manager_id: manager.managerId,
                    league_id: activeLeague.sleeper_league_id,
                    year: currentYear,
                    evaluation_text: data.evaluation,
                    regenerated: false
                });
                setRegenStatus(prev => ({ ...prev, [manager.managerId]: false }));
            }

            setEvaluations(prev => ({ ...prev, [manager.managerId]: newEvalParsed }));
        } catch (err) {
            console.error("Scouting Pipeline Root Error:", err);
            setUiErrorMessage(err.message || "Failed to parse system response.");
        } finally {
            setEvalLoading(false);
        }
    };

    useEffect(() => {
        if (selectedManager && !evaluations[selectedManager.managerId] && !evalLoading) {
            runEvaluation(selectedManager, false, true);
        }
    }, [selectedManager]);

    if (loading) return <div className={styles.loading}>Loading Franchise Owners...</div>;

    if (selectedManager) {
        const evalData = evaluations[selectedManager.managerId];
        const hasRegenerated = regenStatus[selectedManager.managerId];
        const canRegenerate = activeLeague?.is_commissioner || myManagerId === selectedManager.managerId;

        return (
            <div className={styles.container}>
                <div className={styles.detailedView}>
                    <button className={styles.backBtn} onClick={() => setSearchParams({})}>
                        <i className="material-icons">arrow_back</i> Back to Managers
                    </button>
                    
                    <div className={styles.detailHeader}>
                        <img src={selectedManager.teamAvatar} alt="Team" className={styles.detailAvatar} />
                        <div className={styles.detailTitle}>
                            <h1>{selectedManager.teamName}</h1>
                            <h3>@{selectedManager.username}</h3>
                        </div>
                    </div>

                    <div className={styles.detailBody}>
                        <div className={styles.detailColumn}>
                            <h4 className={styles.sectionHeading}>Historical Accolades</h4>
                            <div className={styles.accoladesList}>
                                <div className={styles.accoladeItem}>
                                    <span className={styles.emoji}>🏆</span> 
                                    <strong>Championships:</strong> {selectedManager.rings.length > 0 ? selectedManager.rings.join(', ') : 'None'}
                                </div>
                                <div className={styles.accoladeItem}>
                                    <span className={styles.emoji}>🥈</span> 
                                    <strong>Runner-Ups:</strong> {selectedManager.runnerUps.length > 0 ? selectedManager.runnerUps.join(', ') : 'None'}
                                </div>
                                <div className={styles.accoladeItem}>
                                    <span className={styles.emoji}>🚽</span> 
                                    <strong>Toilet Bowls:</strong> {selectedManager.toiletBowls.length > 0 ? selectedManager.toiletBowls.join(', ') : 'None'}
                                </div>
                            </div>
                            <h4 className={styles.sectionHeading} style={{marginTop: '30px'}}>All-Time Record</h4>
                            <div className={styles.recordBox}>
                                {selectedManager.record.wins}W - {selectedManager.record.losses}L {selectedManager.record.ties > 0 ? `- ${selectedManager.record.ties}T` : ''}
                            </div>
                        </div>

                        <div className={styles.detailColumn}>
                            <h4 className={styles.sectionHeading}>Franchise Analytics</h4>
                            <div className={styles.aiBox}>
                                {uiErrorMessage ? (
                                    <p style={{ color: '#ef4444', fontSize: '0.9em' }}><strong>Pipeline Failure:</strong> {uiErrorMessage}</p>
                                ) : !evalData && !evalLoading ? (
                                    <div style={{ textAlign: 'center', padding: '15px 0' }}>
                                        <button 
                                            onClick={() => runEvaluation(selectedManager, false, false)}
                                            style={{ background: '#eebf1c', border: 'none', color: '#121212', padding: '10px 15px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9em', fontWeight: 'bold', marginBottom: '15px' }}
                                        >
                                            Generate AI Scouting Report
                                        </button>
                                        <div style={{ fontSize: '0.75em', color: '#94a3b8', lineHeight: '1.5', padding: '0 10px' }}>
                                            <p style={{ margin: '0 0 6px 0', fontWeight: '500' }}>You are allotted one initial generation and 1 manual regeneration per season.</p>
                                            <p style={{ margin: '0', fontStyle: 'italic', color: '#64748b' }}>*For Keeper & Redraft leagues, we highly recommend waiting until after your draft is complete to generate your evaluation for the most accurate results.</p>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <p><strong>Strategy Pattern:</strong> {evalData?.strategy} </p>
                                        <p><strong>Manager Profile:</strong> {evalData?.profile} </p>
                                        <p><strong>Trading Philosophy:</strong> {evalData?.philosophy} </p>
                                    </>
                                )}
                                
                                {evalLoading && <span className={styles.aiSubtext}>Gemini Engine compiling records...</span>}
                                
                                {evalData && !evalLoading && canRegenerate && !uiErrorMessage && (
                                    <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                        {hasRegenerated ? (
                                            <span className={styles.aiSubtext} style={{ color: '#ef4444' }}>
                                                You have already used your manual regeneration for this season.
                                            </span>
                                        ) : (
                                            <div style={{ textAlign: 'center' }}>
                                                <button 
                                                    onClick={() => runEvaluation(selectedManager, true, false)}
                                                    style={{ background: '#1e2530', border: '1px solid #eebf1c', color: '#eebf1c', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85em', fontWeight: 'bold', marginBottom: '8px' }}
                                                >
                                                    Regenerate Scouting Report (1 Remaining)
                                                </button>
                                                <p style={{ fontSize: '0.7em', color: '#64748b', fontStyle: 'italic', margin: '0' }}>*Keeper & Redraft leagues: Ensure your draft is complete before using your final regeneration.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.headerControls}>
                <h2 className={styles.title}>League Managers</h2>
            </div>
            <div className={styles.managersGrid}>
                {mergedManagers.map(manager => (
                    <div 
                        key={manager.managerId} 
                        className={styles.managerCard} 
                        onClick={() => setSearchParams({ manager: manager.managerId })}
                    >
                        <div className={styles.cardHeader}>
                            <img src={manager.teamAvatar} alt="Avatar" className={styles.avatar} />
                            <div className={styles.headerText}>
                                <h3 className={styles.teamName}>{manager.teamName}</h3>
                                <div className={styles.userName}>@{manager.username}</div>
                            </div>
                        </div>
                        
                        <div className={styles.metaStrip}>
                            <div className={styles.favTeamWrapper}>
                                {manager.favoriteTeam ? (
                                    <img 
                                        src={`https://sleepercdn.com/images/team_logos/nfl/${manager.favoriteTeam.toLowerCase()}.png`} 
                                        alt="Fav Team" 
                                        className={styles.favTeamIcon} 
                                    />
                                ) : (
                                    <div className={styles.noFavTeam}>No Team Link</div>
                                )}
                            </div>
                            <div className={styles.ringCount}>
                                🏆 {manager.rings.length}
                            </div>
                        </div>

                        <div className={styles.aiSnippet}>
                            <i className="material-icons">auto_awesome</i> 
                            <span>Scouting report ready</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}