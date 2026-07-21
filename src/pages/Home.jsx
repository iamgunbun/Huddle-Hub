import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers, getLeagueData, loadPlayers } from '../utils/helper';
import { getTeamFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import styles from './Home.module.css';
import ProjectionsPanel from '../components/Projections/ProjectionsPanel';

export default function Home() {
    const navigate = useNavigate();
    const { activeLeague, loading: leagueLoading } = useLeague();
         
    const [copyLinkText, setCopyLinkText] = useState('Copy Invite Link');
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1100);
    
    // Replaced modal state with Mobile Tab Navigation State
    const [activeMobileTab, setActiveMobileTab] = useState('feed');
         
    const [authChecking, setAuthChecking] = useState(true);
    const [recentChamp, setRecentChamp] = useState(null);
    const [teamManagers, setTeamManagers] = useState(null);
    const [leagueRole, setLeagueRole] = useState('Member');
    const [leagueTenure, setLeagueTenure] = useState('Loading...');

    // Financial Tracking State for League Hub Card
    const [myTxnCount, setMyTxnCount] = useState(0);
    const [myBalanceOwed, setMyBalanceOwed] = useState(0);

    // Live Fantasy News State
    const [fantasyNews, setFantasyNews] = useState([]);
    const [loadingNews, setLoadingNews] = useState(true);

    useEffect(() => {
        const verifyAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                navigate('/login');
            } else {
                setAuthChecking(false);
            }
        };
        verifyAuth();
    }, [navigate]);

    // Fetch Fantasy News Pipeline
    useEffect(() => {
        let isMounted = true;
        const fetchNews = async () => {
            setLoadingNews(true);
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

                        // Filter for fantasy-relevant terms
                        const fantasyFiltered = espnArticles.filter(a => {
                            const txt = `${a.title} ${a.description}`.toLowerCase();
                            return txt.includes('fantasy') || 
                                   txt.includes('waiver') || 
                                   txt.includes('rankings') || 
                                   txt.includes('start') || 
                                   txt.includes('sit') || 
                                   txt.includes('roster') ||
                                   txt.includes('injury') ||
                                   txt.includes('trade');
                        });
                        
                        if (isMounted) {
                            setFantasyNews(fantasyFiltered.slice(0, 5)); 
                        }
                    }
                }
            } catch(err) {
                console.warn("ESPN home fetch failed:", err);
            } finally {
                if (isMounted) setLoadingNews(false);
            }
        };

        fetchNews();
        return () => { isMounted = false; };
    }, []);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 1100);
        window.addEventListener('resize', handleResize);
                 
        const fetchHubData = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            const sleeperId = activeLeague.sleeper_league_id;
            try {
                const [managersData, pData, currentLeagueData] = await Promise.all([
                    getLeagueTeamManagers(sleeperId),
                    loadPlayers(),
                    getLeagueData(sleeperId)
                ]);
                
                setTeamManagers(managersData);
                const playersMap = pData?.players || {};
                const { data: { session } } = await supabase.auth.getSession();
                                 
                if (session?.user) {
                    const { data: ulData } = await supabase.from('user_leagues')
                        .select('team_name')
                        .eq('user_id', session.user.id)
                        .eq('league_id', activeLeague.id)
                        .single();

                    const { data: dbLeagueMeta } = await supabase.from('leagues')
                        .select('dues_amount, enable_txn_fees, txn_fee_amount, exclude_defenses_from_fees, financial_ledger')
                        .eq('id', activeLeague.id)
                        .maybeSingle();
                                         
                    let currentRole = activeLeague.is_commissioner ? 'Commissioner' : 'Member';
                    let tenureText = '1st Year';
                    const leagueYears = Object.keys(managersData.teamManagersMap).map(Number);
                    const currentYear = managersData.currentSeason;
                                         
                    if (leagueYears.length > 0) {
                        const leagueStartYear = Math.min(...leagueYears);
                        const totalSeasons = leagueYears.length;
                        tenureText = `${leagueStartYear} - Present (${totalSeasons} Year${totalSeasons > 1 ? 's' : ''})`;
                    }
                                         
                    let activeRosterId = null;

                    if (ulData?.team_name) {
                        const searchName = ulData.team_name.toLowerCase().trim();
                                                 
                        if (searchName !== 'commissioner team') {
                            const rostersMap = managersData.teamManagersMap[currentYear] || {};
                            for (const [rId, rData] of Object.entries(rostersMap)) {
                                const apiTeamName = rData.team?.name?.toLowerCase().trim();
                                if (apiTeamName === searchName) {
                                    activeRosterId = rId;
                                    const isCoOwner = rData.managers?.length > 1;
                                                                         
                                    if (activeLeague.is_commissioner) {
                                        currentRole = isCoOwner ? 'Co-Commissioner' : 'Commissioner';
                                    } else {
                                        currentRole = isCoOwner ? 'Co-Manager' : 'Member';
                                    }
                                    break;
                                }
                             }
                        }
                    }
                                         
                    setLeagueRole(currentRole);
                    setLeagueTenure(tenureText);

                    if (activeRosterId) {
                        let allTxns = [];
                        for (let i = 0; i <= 18; i++) {
                            const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}/transactions/${i}`);
                            if (res.ok) {
                                const data = await res.json();
                                allTxns = [...allTxns, ...data];
                            }
                        }
                        
                        const completedTxns = allTxns.filter(t => t.status === 'complete');
                        const isExcludeDefsEnabled = dbLeagueMeta?.exclude_defenses_from_fees ?? false;

                        let calculatedAddsCount = 0;
                        const rIdInt = parseInt(activeRosterId);

                        completedTxns.forEach(txn => {
                            if (txn.type === 'trade') {
                                if (txn.roster_ids && txn.roster_ids.includes(rIdInt)) {
                                    calculatedAddsCount++;
                                }
                            } else if (txn.type === 'waiver' || txn.type === 'free_agent') {
                                if (txn.adds) {
                                    Object.entries(txn.adds).forEach(([pId, rId]) => {
                                        if (rId.toString() === activeRosterId.toString()) {
                                            const isDef = playersMap[pId]?.pos === 'DEF';
                                            if (!isExcludeDefsEnabled || !isDef) {
                                                calculatedAddsCount++;
                                            }
                                        }
                                    });
                                }
                            }
                        });

                        setMyTxnCount(calculatedAddsCount);

                        const baseDues = dbLeagueMeta?.dues_amount ?? 100;
                        const txnFeeCost = dbLeagueMeta?.enable_txn_fees ? (calculatedAddsCount * (dbLeagueMeta?.txn_fee_amount ?? 1)) : 0;
                        const totalGrossOwed = baseDues + txnFeeCost;
                        
                        const ledger = dbLeagueMeta?.financial_ledger || {};
                        const collectedAmount = ledger[activeRosterId] || 0;
                        
                        setMyBalanceOwed(totalGrossOwed - collectedAmount);
                    }
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

    if (authChecking || leagueLoading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', textAlign: 'center' }}>
                <img 
                     src="/brand.png" 
                     alt="Huddle Logo" 
                     style={{ maxWidth: '180px', marginBottom: '25px', animation: 'pulse 1.5s infinite ease-in-out' }} 
                 />
                <h2 style={{ color: '#eebf1c', textTransform: 'uppercase', letterSpacing: '2px', fontSize: '1.2em' }}>
                    Loading your Leagues...
                </h2>
            </div>
        );
    }

    if (!activeLeague) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', textAlign: 'center', color: '#f8fafc' }}>
                <h1 style={{ fontWeight: '500', textTransform: 'uppercase', letterSpacing: '2px' }}>Welcome to Huddle</h1>
                <p style={{ color: '#94a3b8', marginBottom: '30px' }}>You don't have any active leagues connected to your account.</p>
                <button 
                     onClick={() => navigate('/add-league')}
                     style={{ padding: '14px 28px', background: '#eebf1c', color: '#000', border: 'none', borderRadius: '8px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1px', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                    Connect a League
                </button>
            </div>
        );
    }

    const champTeam = (recentChamp && teamManagers) ? getTeamFromTeamManagers(teamManagers, recentChamp.champion, recentChamp.year) : null;
    
    // Extracted News Feed Component Block
    const renderNewsFeed = () => (
        <div className={styles.hubCard}>
            <h3 className={styles.cardHeader}>
                <i className="material-icons" style={{ fontSize: '1.2em', verticalAlign: 'text-bottom', marginRight: '6px', color: '#eebf1c' }}>article</i>
                Latest Fantasy News
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {loadingNews ? (
                    <div style={{ color: '#94a3b8', fontStyle: 'italic', padding: '10px 0' }}>Fetching latest updates...</div>
                ) : fantasyNews.length > 0 ? (
                    fantasyNews.map(article => (
                        <a 
                            key={article.id} 
                            href={article.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ 
                                textDecoration: 'none', color: 'inherit', display: 'flex', gap: '12px', 
                                alignItems: 'flex-start', background: 'rgba(255,255,255,0.02)', padding: '12px', 
                                borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' 
                            }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                        >
                            {article.image && (
                                <img src={article.image} alt="" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                            )}
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: '0.9em', fontWeight: 'bold', color: '#f8fafc', marginBottom: '4px', lineHeight: '1.3' }}>{article.title}</span>
                                <span style={{ fontSize: '0.8em', color: '#94a3b8' }}>{article.date} via {article.source}</span>
                            </div>
                        </a>
                    ))
                ) : (
                    <div style={{ color: '#94a3b8', padding: '10px 0' }}>No recent fantasy updates found.</div>
                )}
            </div>
        </div>
    );

    return (
        <div className={styles.homeContainer}>
            {!isMobile ? (
                <div className={styles.dashboardGrid}>
                    {/* Column 1: Projections */}
                    <div className={styles.column}>
                        <ProjectionsPanel />
                    </div>
                                         
                    {/* Column 2: Commish Note & News Feed */}
                    <div className={styles.column}>
                        <div className={styles.commishNote}>
                            <h3 className={styles.cardHeader}>Commissioner's Note</h3>
                            <div style={{ color: '#f8fafc', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                                {activeLeague.commish_note || 'Welcome to your dynasty hub. The commissioner has not set a message yet.'}
                            </div>
                        </div>
                        
                        {renderNewsFeed()}
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
                                                         
                            <div className={styles.infoRow}>
                                <span className={styles.infoLabel}>
                                    <i className="material-icons" style={{ fontSize: '1.1em', color: '#eebf1c', marginRight: '8px' }}>calendar_today</i> League Tenure
                                </span>
                                <span className={styles.infoValue}>{leagueTenure}</span>
                            </div>

                            <div className={styles.infoRow} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '12px' }}>
                                <span className={styles.infoLabel}>
                                    <i className="material-icons" style={{ fontSize: '1.1em', color: '#ffaa00', marginRight: '8px' }}>swap_calls</i> Add Transactions
                                </span>
                                <span className={styles.infoValue}>{myTxnCount} moves</span>
                            </div>

                            <div className={styles.infoRow} style={{ marginBottom: '20px' }}>
                                <span className={styles.infoLabel}>
                                    <i className="material-icons" style={{ fontSize: '1.1em', color: myBalanceOwed > 0 ? '#ff2a6d' : '#00ceb8', marginRight: '8px' }}>monetization_on</i> Balance Due
                                </span>
                                <span className={styles.infoValue} style={{ color: myBalanceOwed > 0 ? '#ff2a6d' : '#00ceb8', fontWeight: '800' }}>
                                    ${myBalanceOwed.toFixed(2)}
                                </span>
                            </div>
                                                         
                            <button className={styles.fullWidthBtn} onClick={copyInviteLink}>{copyLinkText}</button>
                        </div>
                        {champTeam && (
                            <div className={styles.hubCard} style={{ textAlign: 'center', marginTop: '20px' }}>
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
                    {/* NEW: Sleek Top Navigation Bar for Mobile */}
                    <div className={styles.mobileTopNav}>
                        <button 
                            className={`${styles.navTab} ${activeMobileTab === 'feed' ? styles.activeTab : ''}`}
                            onClick={() => setActiveMobileTab('feed')}
                        >
                            <i className="material-icons">feed</i>
                            Overview
                        </button>
                        <button 
                            className={`${styles.navTab} ${activeMobileTab === 'projections' ? styles.activeTab : ''}`}
                            onClick={() => setActiveMobileTab('projections')}
                        >
                            <i className="material-icons">query_stats</i>
                            Projections
                        </button>
                        <button 
                            className={`${styles.navTab} ${activeMobileTab === 'hub' ? styles.activeTab : ''}`}
                            onClick={() => setActiveMobileTab('hub')}
                        >
                            <i className="material-icons">info</i>
                            League Hub
                        </button>
                    </div>

                    {/* NEW: Tab-Driven Content Container */}
                    <div className={`${styles.mobileTabContent} ${styles.fadeEnter}`} key={activeMobileTab}>
                        
                        {activeMobileTab === 'feed' && (
                            <>
                                <div className={styles.commishNote}>
                                    <h3 className={styles.cardHeader}>Commissioner's Note</h3>
                                    <div style={{ color: '#f8fafc', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                                        {activeLeague.commish_note || 'Welcome to your dynasty hub. The commissioner has not set a message yet.'}
                                    </div>
                                </div>
                                {renderNewsFeed()}
                            </>
                        )}

                        {activeMobileTab === 'projections' && (
                            <div>
                                <ProjectionsPanel />
                            </div>
                        )}

                        {activeMobileTab === 'hub' && (
                            <>
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
                                    <div className={styles.infoRow}>
                                        <span className={styles.infoLabel}>League Tenure</span>
                                        <span className={styles.infoValue}>{leagueTenure}</span>
                                    </div>
                                    
                                    <div className={styles.infoRow} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px', marginTop: '10px' }}>
                                        <span className={styles.infoLabel}>Add Transactions</span>
                                        <span className={styles.infoValue}>{myTxnCount} moves</span>
                                    </div>
                                    <div className={styles.infoRow} style={{ marginBottom: '20px' }}>
                                        <span className={styles.infoLabel}>Balance Due</span>
                                        <span className={styles.infoValue} style={{ color: myBalanceOwed > 0 ? '#ff2a6d' : '#00ceb8', fontWeight: '800' }}>
                                            ${myBalanceOwed.toFixed(2)}
                                        </span>
                                    </div>

                                    <button className={styles.fullWidthBtn} onClick={copyInviteLink}>{copyLinkText}</button>
                                </div>
                                
                                {champTeam && (
                                    <div className={styles.hubCard} style={{ textAlign: 'center' }}>
                                        <h3 className={styles.cardHeader} style={{ border: 'none', marginBottom: 0 }}>{recentChamp.year} Champion</h3>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
                                            <div style={{ color: '#eebf1c', fontSize: '1.2em', fontWeight: 800, textTransform: 'uppercase' }}>{champTeam.name}</div>
                                            <img src={champTeam.avatar} alt="Champ" style={{ width: '60px', height: '60px', borderRadius: '50%', border: '2px solid #eebf1c', objectFit: 'cover' }} />
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                        
                    </div>
                </div>
            )}
        </div>
    );
}