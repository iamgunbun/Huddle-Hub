import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers, getAwards, getLeagueRecords } from '../utils/helper';
import { syncActiveLeague } from '../utils/leagueInfo';
import styles from './Managers.module.css';

export default function Managers() {
    const { activeLeague } = useLeague();
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [mergedManagers, setMergedManagers] = useState([]);
    
    const selectedManagerId = searchParams.get('manager');
    const selectedManager = mergedManagers.find(m => m.managerId === selectedManagerId);

    const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    useEffect(() => {
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            
            try {
                localStorage.removeItem("records");
                localStorage.removeItem("awards");

                if (syncActiveLeague) {
                    syncActiveLeague(activeLeague.sleeper_league_id, activeLeague.league_name);
                }

                const [tmData, podiumsData, recordsData] = await Promise.all([
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    getAwards(true, activeLeague.sleeper_league_id),
                    getLeagueRecords(true, activeLeague.sleeper_league_id)
                ]);

                // 1. Fetch user_leagues to get usernames
                const { data: ulData } = await supabase
                    .from('user_leagues')
                    .select('user_id, team_name')
                    .eq('league_id', activeLeague.id);

                // 2. Fetch profiles separately to safely bypass Supabase Foreign Key join blocks
                const userIds = ulData?.map(u => u.user_id) || [];
                const { data: profilesData } = await supabase
                    .from('profiles')
                    .select('id, favorite_team')
                    .in('id', userIds);

                // 3. Merge them manually
                const dbUsers = ulData?.map(ul => ({
                    ...ul,
                    favorite_team: profilesData?.find(p => p.id === ul.user_id)?.favorite_team
                }));

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
                        return dbName === normalizeStr(teamName) || 
                               dbName === normalizeStr(sleeperUser.display_name) ||
                               dbName === normalizeStr(sleeperUser.username);
                    });

                    const favoriteTeam = supaUser?.favorite_team || null;

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
                        favoriteTeam: favoriteTeam,
                        rings: rings,
                        runnerUps: runnerUps,
                        toiletBowls: toiletBowls,
                        record: managerRecord
                    });
                }

                formatted.sort((a, b) => b.rings.length - a.rings.length);
                setMergedManagers(formatted);

            } catch (e) {
                console.error("Failed to load managers:", e);
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [activeLeague]);

    if (loading) return <div className={styles.loading}>Loading Franchise Owners...</div>;

    if (selectedManager) {
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
                            <h4 className={styles.sectionHeading}>Analytics (Pending)</h4>
                            <div className={styles.aiBox}>
                                <p><strong>Strategy Pattern:</strong> Evaluating roster composition... <br/><span className={styles.aiSubtext}>Evaluation Pending</span></p>
                                <p><strong>Manager Profile:</strong> Generating historical summary... <br/><span className={styles.aiSubtext}>Evaluation Pending</span></p>
                                <p><strong>Trading Philosophy:</strong> Analyzing historical transactions... <br/><span className={styles.aiSubtext}>Evaluation Pending</span></p>
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
                            <span>Evaluation Pending...</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}