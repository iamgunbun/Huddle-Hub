import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers, getLeagueData } from '../utils/helper';
import { getTeamFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import styles from './Home.module.css';
import Transactions from '../components/Transactions/Transactions';
import ProjectionsPanel from '../components/Projections/ProjectionsPanel';

export default function Home() {
    const { activeLeague } = useLeague();
    
    // UI State
    const [copyLinkText, setCopyLinkText] = useState('Copy Invite Link');
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1100);
    
    // Data State
    const [recentChamp, setRecentChamp] = useState(null);
    const [teamManagers, setTeamManagers] = useState(null);
    const [leagueRole, setLeagueRole] = useState('Member');
    const [leagueTenure, setLeagueTenure] = useState('Loading...');

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 1100);
        window.addEventListener('resize', handleResize);
        
        const fetchHubData = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            const sleeperId = activeLeague.sleeper_league_id;

            try {
                const managersData = await getLeagueTeamManagers(sleeperId);
                setTeamManagers(managersData);

                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    const { data: ulData } = await supabase.from('user_leagues')
                        .select('team_name')
                        .eq('user_id', session.user.id)
                        .eq('league_id', activeLeague.id)
                        .single();
                    
                    let currentRole = activeLeague.is_commissioner ? 'Commissioner' : 'Member';
                    let tenureText = '1st Year';

                    const leagueYears = Object.keys(managersData.teamManagersMap).map(Number);
                    const currentYear = managersData.currentSeason;
                    
                    if (leagueYears.length > 0) {
                        const leagueStartYear = Math.min(...leagueYears);
                        const totalSeasons = leagueYears.length;
                        tenureText = `${leagueStartYear} - Present (${totalSeasons} Year${totalSeasons > 1 ? 's' : ''})`;
                    }

                    if (ulData?.team_name) {
                        const searchName = ulData.team_name.toLowerCase().trim();
                        let myManagerId = null;

                        if (searchName !== 'commissioner team') {
                            const rostersMap = managersData.teamManagersMap[currentYear] || {};
                            for (const [rId, rData] of Object.entries(rostersMap)) {
                                const apiTeamName = rData.team?.name?.toLowerCase().trim();
                                if (apiTeamName === searchName) {
                                    myManagerId = rData.managers?.[0];
                                    const isCoOwner = rData.managers?.length > 1;
                                    
                                    if (activeLeague.is_commissioner) {
                                        currentRole = isCoOwner ? 'Co-Commissioner' : 'Commissioner';
                                    } else {
                                        currentRole = isCoOwner ? 'Co-Manager' : 'Member';
                                    }
                                    break;
                                }
                            }
                            if (!myManagerId) {
                                for (const [uId, uData] of Object.entries(managersData.users)) {
                                    if (uData.display_name?.toLowerCase().trim() === searchName || 
                                        uData.metadata?.team_name?.toLowerCase().trim() === searchName) {
                                        myManagerId = uId;
                                        break;
                                    }
                                }
                            }
                        }

                        if (myManagerId) {
                            const activeYears = [];
                            for (const y in managersData.teamManagersMap) {
                                for (const r in managersData.teamManagersMap[y]) {
                                    if (managersData.teamManagersMap[y][r].managers?.includes(myManagerId)) {
                                        activeYears.push(parseInt(y));
                                    }
                                }
                            }
                            if (activeYears.length > 0) {
                                const minYear = Math.min(...activeYears);
                                const maxYear = Math.max(...activeYears);
                                const yearCount = activeYears.length;
                                tenureText = `${minYear} - ${maxYear === parseInt(currentYear) ? 'Present' : maxYear} (${yearCount} Year${yearCount > 1 ? 's' : ''})`;
                            }
                        }
                    }
                    
                    setLeagueRole(currentRole);
                    setLeagueTenure(tenureText);
                }

                const leagueData = await getLeagueData(sleeperId);
                const prevLeagueId = leagueData?.status === "complete" ? leagueData.league_id : leagueData?.previous_league_id;
                
                if (prevLeagueId && prevLeagueId !== "0") {
                    const [prevLeagueRes, winnersRes] = await Promise.all([
                        fetch(`https://api.sleeper.app/v1/league/${prevLeagueId}`),
                        fetch(`https://api.sleeper.app/v1/league/${prevLeagueId}/winners_bracket`)
                    ]);
                    
                    const prevLeagueData = await prevLeagueRes.json();
                    const winnersBracket = await winnersRes.json();
                    
                    if (winnersBracket && winnersBracket.length > 0) {
                        const playoffRounds = winnersBracket[winnersBracket.length - 1].r;
                        const finalsMatch = winnersBracket.find(m => m.r === playoffRounds && m.t1_from?.w);
                        if (finalsMatch) {
                            setRecentChamp({ year: prevLeagueData.season, champion: finalsMatch.w });
                        }
                    }
                }
            } catch (e) {
                console.error("Dashboard data load failed:", e);
            }
        };

        fetchHubData();
        return () => window.removeEventListener('resize', handleResize);
    }, [activeLeague]);

    const copyInviteLink = () => {
        if (!activeLeague?.id) return;
        const inviteUrl = `${window.location.origin}/invite/${activeLeague.id}`;
        navigator.clipboard.writeText(inviteUrl).then(() => {
            setCopyLinkText('Copied!');
            setTimeout(() => setCopyLinkText('Copy Invite Link'), 2000);
        });
    };

    if (!activeLeague) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', textAlign: 'center', color: '#f8fafc' }}>
                <h1 style={{ fontWeight: '500', textTransform: 'uppercase', letterSpacing: '2px' }}>Welcome to Huddle</h1>
                <p style={{ color: '#94a3b8' }}>You don't have any active leagues connected to your account.</p>
            </div>
        );
    }

    const champTeam = (recentChamp && teamManagers) ? getTeamFromTeamManagers(teamManagers, recentChamp.champion, recentChamp.year) : null;

    return (
        <div className={styles.homeContainer}>
            {!isMobile ? (
                <div className={styles.dashboardGrid}>
                    {/* Column 1: Projections */}
                    <div className={styles.column}>
                        <ProjectionsPanel />
                    </div>
                    
                    {/* Column 2: Commish Note & Activity */}
                    <div className={styles.column}>
                        <div className={styles.commishNote}>
                            <h3 className={styles.cardHeader}>Commissioner's Note</h3>
                            <div style={{ color: '#f8fafc', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                                {/* CORRECTED TO COMMISH_NOTE */}
                                {activeLeague.commish_note || 'Welcome to your dynasty hub. The commissioner has not set a message yet.'}
                            </div>
                        </div>
                        
                        {/* Ensure preview is TRUE for the Home Page */}
                        <Transactions preview={true} />
                    </div>
                    
                    {/* Column 3: League Hub Info & Champion */}
                    <div className={styles.column}>
                        <div className={styles.hubCard}>
                            <h3 className={styles.cardHeader}>League Hub Info</h3>
                            
                            <div className={styles.infoRow}>
                                <span className={styles.infoLabel}>
                                    <i className="material-icons" style={{ fontSize: '1.1em', color: '#eebf1c', marginRight: '8px' }}>sports_football</i> Platform
                                </span>
                                <span className={styles.infoValue} style={{ textTransform: 'capitalize' }}>
                                    {activeLeague.platform || 'Sleeper'}
                                </span>
                            </div>
                            
                            <div className={styles.infoRow}>
                                <span className={styles.infoLabel}>
                                    <i className="material-icons" style={{ fontSize: '1.1em', color: '#eebf1c', marginRight: '8px' }}>shield</i> Your Role
                                </span>
                                <span className={styles.infoValue} style={{ color: '#eebf1c' }}>{leagueRole}</span>
                            </div>
                            
                            <div className={styles.infoRow} style={{ marginBottom: '20px' }}>
                                <span className={styles.infoLabel}>
                                    <i className="material-icons" style={{ fontSize: '1.1em', color: '#eebf1c', marginRight: '8px' }}>calendar_today</i> League Tenure
                                </span>
                                <span className={styles.infoValue}>{leagueTenure}</span>
                            </div>
                            
                            <button className={styles.fullWidthBtn} onClick={copyInviteLink}>{copyLinkText}</button>
                        </div>

                        {champTeam && (
                            <div className={styles.hubCard} style={{ textAlign: 'center' }}>
                                <h3 className={styles.cardHeader} style={{ border: 'none', marginBottom: 0 }}>{recentChamp.year} Champion</h3>
                                <img
                                    src={champTeam.avatar}
                                    alt="Champ"
                                    style={{ width: '80px', height: '80px', borderRadius: '50%', border: '3px solid #eebf1c', margin: '15px auto', display: 'block', objectFit: 'cover' }}
                                />
                                <div style={{ color: '#eebf1c', fontSize: '1.3em', fontWeight: 800, textTransform: 'uppercase' }}>
                                    {champTeam.name}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className={styles.mobileLayout}>
                    <div className={styles.commishNote}>
                        <h3 className={styles.cardHeader}>Commissioner's Note</h3>
                        <div style={{ color: '#f8fafc', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                            {/* CORRECTED TO COMMISH_NOTE */}
                            {activeLeague.commish_note || 'Welcome to your dynasty hub. The commissioner has not set a message yet.'}
                        </div>
                    </div>

                    <div className={styles.hubCard}>
                        <h3 className={styles.cardHeader}>League Hub Info</h3>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Platform</span>
                            <span className={styles.infoValue} style={{ textTransform: 'capitalize' }}>{activeLeague.platform || 'Sleeper'}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Your Role</span>
                            <span className={styles.infoValue} style={{ color: '#eebf1c' }}>{leagueRole}</span>
                        </div>
                        <div className={styles.infoRow} style={{ marginBottom: '20px' }}>
                            <span className={styles.infoLabel}>League Tenure</span>
                            <span className={styles.infoValue}>{leagueTenure}</span>
                        </div>
                    </div>

                    {champTeam && (
                        <div className={styles.hubCard} style={{ textAlign: 'center' }}>
                            <h3 className={styles.cardHeader} style={{ border: 'none', marginBottom: 0 }}>{recentChamp.year} Champion</h3>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
                                <div style={{ color: '#eebf1c', fontSize: '1.1em', fontWeight: 800, textTransform: 'uppercase' }}>{champTeam.name}</div>
                                <img src={champTeam.avatar} alt="Champ" style={{ width: '50px', height: '50px', borderRadius: '50%', border: '2px solid #eebf1c', objectFit: 'cover' }} />
                            </div>
                        </div>
                    )}

                    <Transactions preview={true} />
                </div>
            )}
        </div>
    );
}