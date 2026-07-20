import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueData } from '../utils/helper';
import styles from './PlayerModal.module.css';

// Unified Matchup Formatter - Forces strict uppercase 'VS' and '@'
const formatOpponent = (opp) => {
    if (!opp || opp === '-' || opp === 'BYE' || opp === 'TBD') return (opp || '-').toUpperCase();
    
    const isAway = opp.includes('@');
    const cleanOpp = opp.replace(/[@]/g, '').replace(/vs\.?/gi, '').trim().toUpperCase();
    
    if (!cleanOpp) return '-';
    return isAway ? `@ ${cleanOpp}` : `VS ${cleanOpp}`;
};

export default function PlayerModal({ player, onClose, week }) {
    const { activeLeague } = useLeague();
    const [scoringSettings, setScoringSettings] = useState(null);
    const [activeYear, setActiveYear] = useState('2026');
    
    const [playerNews, setPlayerNews] = useState([]);
    const [loadingNews, setLoadingNews] = useState(true);
    const [isCachedNews, setIsCachedNews] = useState(false);
    const [gameLogs, setGameLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(true);
    
    const [rosterPct, setRosterPct] = useState('-');
    const [startPct, setStartPct] = useState('-');

    const currentWeekNum = parseInt(week) || 1;

    const availableYears = useMemo(() => {
        const currentYear = 2026;
        const yearsExp = player?.exp || 0;
        const startYear = currentYear - yearsExp;
        const years = [];
        for (let y = currentYear; y >= startYear; y--) {
            years.push(String(y));
        }
        return years;
    }, [player?.exp]);

    useEffect(() => {
        if (!availableYears.includes(activeYear)) {
            setActiveYear(availableYears[0]);
        }
    }, [availableYears, activeYear]);

    const pos = player?.pos || 'UNK';
    // Force team abbreviations to match formatting
    const team = (player?.t || 'FA').toUpperCase(); 
    const name = `${player?.fn} ${player?.ln}`;
    const initialAvatar = pos === 'DEF' 
        ? `https://sleepercdn.com/images/team_logos/nfl/${player?.id.toLowerCase()}.png` 
        : `https://sleepercdn.com/content/nfl/players/thumb/${player?.id}.jpg`;
        
    const [avatarUrl, setAvatarUrl] = useState(initialAvatar);

    useEffect(() => {
        setAvatarUrl(initialAvatar);
    }, [initialAvatar]);

    useEffect(() => {
        let isMounted = true;
        if (activeLeague?.sleeper_league_id) {
            getLeagueData(activeLeague.sleeper_league_id).then(d => {
                if (isMounted && d?.scoring_settings) {
                    setScoringSettings(d.scoring_settings);
                }
            });
        }
        return () => { isMounted = false; };
    }, [activeLeague]);

    useEffect(() => {
        let isMounted = true;
        const fetchResearchData = async () => {
            if (!player?.id) return;
            try {
                const url = `https://api.sleeper.app/players/nfl/research/regular/${activeYear}/${currentWeekNum}`;
                const res = await fetch(url).catch(() => null);
                if (res && res.ok) {
                    const data = await res.json();
                    if (isMounted && data[player.id]) {
                        setRosterPct(typeof data[player.id].owned === 'number' ? `${data[player.id].owned.toFixed(1)}%` : '-');
                        setStartPct(typeof data[player.id].started === 'number' ? `${data[player.id].started.toFixed(1)}%` : '-');
                    }
                }
            } catch (err) { console.warn("Failed to fetch research data:", err); }
        };
        fetchResearchData();
        return () => { isMounted = false; };
    }, [player?.id, activeYear, currentWeekNum]);

    useEffect(() => {
        let isMounted = true;
        const fetchPlayerNews = async () => {
            if (!player?.id) return;
            setLoadingNews(true);
            setIsCachedNews(false);

            const cacheKey = `huddle_news_${player.id}`;
            let combinedNews = [];
            
            const fullName = `${player.fn} ${player.ln}`.toLowerCase();
            const lastName = (player.ln || '').toLowerCase();
            const teamFilter = (player.t || '').toLowerCase();

            try {
                const apiKey = import.meta.env.VITE_RAPIDAPI_KEY;
                if (apiKey) {
                    const url = `https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLNews?recentNews=true&maxItems=150`;
                    const options = { method: 'GET', headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com' } };
                    const res = await fetch(url, options).catch(() => null);
                    if (res && res.ok) {
                        const data = await res.json();
                        if (data.statusCode === 200 && Array.isArray(data.body)) {
                            const matches = data.body.filter(item => {
                                const title = (item.title || '').toLowerCase();
                                const story = (item.story || item.description || '').toLowerCase();
                                return title.includes(fullName) || story.includes(fullName) || (title.includes(lastName) && title.includes(teamFilter));
                            });
                            combinedNews.push(...matches.map((item, idx) => ({
                                id: `tank-${item.newsID || idx}`,
                                title: item.title,
                                description: item.story || item.description || '',
                                source: item.source || 'Tank01',
                                date: item.newsDate || 'Recent',
                                url: item.link || item.url || ''
                            })));
                        }
                    }
                }
            } catch (err) { console.warn("Tank01 fetch failed:", err); }

            try {
                if (player.espn_id) {
                    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/athletes/${player.espn_id}/news`).catch(()=>null);
                    if (res && res.ok) {
                        const data = await res.json();
                        if (data.articles) {
                            combinedNews.push(...data.articles.map((item, idx) => ({
                                id: `espn-${item.id || idx}`,
                                title: item.headline,
                                description: item.description || item.story || '',
                                source: item.byline || 'ESPN Wire',
                                date: item.published ? new Date(item.published).toLocaleDateString() : 'Archive',
                                url: item.links?.web?.href || ''
                            })));
                        }
                    }
                }
            } catch (err) { console.warn("ESPN fetch failed:", err); }

            if (isMounted) {
                const uniqueNews = Array.from(new Map(combinedNews.map(a => [a.title, a])).values());
                
                if (uniqueNews.length > 0) {
                    const freshFeed = uniqueNews.slice(0, 4);
                    setPlayerNews(freshFeed);
                    setIsCachedNews(false);
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify({
                            timestamp: new Date().toLocaleDateString(),
                            articles: freshFeed
                        }));
                    } catch (e) { console.warn("Storage quota exceeded:", e); }
                } else {
                    const cachedData = localStorage.getItem(cacheKey);
                    if (cachedData) {
                        try {
                            const parsed = JSON.parse(cachedData);
                            setPlayerNews(parsed.articles || []);
                            setIsCachedNews(true);
                        } catch (e) {
                            setPlayerNews([]);
                        }
                    } else {
                        setPlayerNews([]);
                    }
                }
                setLoadingNews(false);
            }
        };

        fetchPlayerNews();
        return () => { isMounted = false; };
    }, [player?.id, player?.fn, player?.ln, player?.espn_id, player?.t]);

    useEffect(() => {
        let isMounted = true;

        const fetchNativeLogs = async () => {
            if (!scoringSettings) return; 
            
            setLoadingLogs(true);
            try {
                const [projRes, statsRes] = await Promise.all([
                    fetch(`https://api.sleeper.com/projections/nfl/player/${player.id}?season_type=regular&season=${activeYear}&grouping=week`).catch(()=>null),
                    fetch(`https://api.sleeper.com/stats/nfl/player/${player.id}?season_type=regular&season=${activeYear}&grouping=week`).catch(()=>null)
                ]);

                let projData = {};
                let statsData = {};

                if (projRes && projRes.ok) projData = await projRes.json();
                if (statsRes && statsRes.ok) statsData = await statsRes.json();

                if (isMounted) {
                    const calcYPC = (yd, att) => (att > 0 && typeof yd !== 'undefined' ? (yd / att).toFixed(1) : '-');
                    const calcCustomPts = (statsObj) => {
                        if (!statsObj || !scoringSettings || Object.keys(statsObj).length === 0) return '-';
                        let pts = 0; let hasStats = false;
                        for (const [key, val] of Object.entries(statsObj)) {
                            if (scoringSettings[key] !== undefined && typeof val === 'number') {
                                pts += val * scoringSettings[key]; hasStats = true;
                            }
                        }
                        return hasStats ? pts.toFixed(2) : '-';
                    };

                    const mergedRows = Array.from({ length: 18 }, (_, idx) => {
                        const wkNum = String(idx + 1);
                        const pWk = projData[wkNum] || {};
                        const sWk = statsData[wkNum] || {};
                        
                        let rawOpp = pWk.opponent || sWk.opponent || '-';
                        const isFuture = parseInt(wkNum) >= currentWeekNum && activeYear === '2026';

                        return {
                            wk: wkNum,
                            opp: formatOpponent(rawOpp), 
                            proj: calcCustomPts(pWk.stats),
                            fpts: calcCustomPts(sWk.stats),
                            isUpcoming: isFuture,
                            att: sWk.stats?.rush_att || '-',
                            yd: sWk.stats?.rush_yd || '-',
                            ypc: calcYPC(sWk.stats?.rush_yd, sWk.stats?.rush_att),
                            td: (sWk.stats?.rush_td || 0) + (sWk.stats?.pass_td || 0) || '-',
                            tar: sWk.stats?.rec_tgt || '-',
                            rec: sWk.stats?.rec || '-',
                            recYd: sWk.stats?.rec_yd || '-',
                            ypt: calcYPC(sWk.stats?.rec_yd, sWk.stats?.rec_tgt),
                            recTd: sWk.stats?.rec_td || '-'
                        };
                    });

                    setGameLogs(mergedRows);
                    setLoadingLogs(false);
                }
            } catch (err) {
                console.error("Failed to fetch native Sleeper logs:", err);
                if (isMounted) { setGameLogs([]); setLoadingLogs(false); }
            }
        };

        fetchNativeLogs();
        return () => { isMounted = false; };
    }, [player?.id, activeYear, currentWeekNum, scoringSettings]);

    if (!player) return null;
    
    const statusColors = {
        Questionable: '#f59e0b', Out: '#ef4444', Doubtful: '#f59e0b', Suspended: '#ef4444', IR: '#ef4444', PUP: '#ef4444'
    };
    
    const getStatusAbbr = (status) => {
        const map = { 'Questionable': 'Q', 'Out': 'O', 'Doubtful': 'D', 'Suspended': 'SUS', 'IR': 'IR', 'PUP': 'PUP' };
        return map[status] || status;
    };

    const detailedInjuryNotes = player.injury_notes || player.injNotes;

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                <div className={styles.topActions}>
                    {player.injStatus && (
                        <div className={styles.statusPill} style={{ backgroundColor: statusColors[player.injStatus] || '#f59e0b' }}>
                            {player.injStatus}
                        </div>
                    )}
                    <button className={styles.closeBtn} onClick={onClose}>
                        <i className="material-icons">close</i>
                    </button>
                </div>
                
                <div className={styles.heroBanner}>
                    <div className={styles.heroLeft}>
                        <div 
                            className={styles.playerImage} 
                            style={{ backgroundImage: `url(${avatarUrl})` }}
                        >
                            <img 
                                src={avatarUrl} 
                                alt="avatar loader" 
                                style={{ display: 'none' }} 
                                onError={() => setAvatarUrl('https://sleepercdn.com/images/v2/icons/player_default.webp')} 
                            />
                            <div className={styles.teamBadgeWrapper}>
                                <div className={styles.posBadge}>{pos}</div>
                                <div className={styles.teamText}>{team}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div className={styles.heroRight}>
                        <h1 className={styles.playerName}>
                            {player.injStatus && (
                                <span className={styles.nameBadge} style={{ color: statusColors[player.injStatus] || '#f59e0b' }}>
                                    {getStatusAbbr(player.injStatus)}
                                </span>
                            )}
                            {name}
                        </h1>
                        
                        <div className={styles.bioGrid}>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>AGE</span>
                                <span className={styles.bioValue}>{player.age || '-'}</span>
                            </div>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>HEIGHT</span>
                                <span className={styles.bioValue}>{player.ht || '-'}</span>
                            </div>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>WEIGHT</span>
                                <span className={styles.bioValue}>{player.wt || '-'} <span className={styles.bioSub}>lbs</span></span>
                            </div>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>EXP</span>
                                <span className={styles.bioValue}>{player.exp === 0 ? 'R' : player.exp}</span>
                            </div>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>COLLEGE</span>
                                <span className={styles.bioValue}>{player.college || '-'}</span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                            <div className={styles.playerRankings}>
                                <h4>PLAYER RANKINGS</h4>
                                <div className={styles.rankingStats}>
                                    <div className={styles.rankItem}>
                                        <span className={styles.rankNum}>#{player.search_rank < 99999 ? player.search_rank : '-'}</span> 
                                        <span className={styles.rankLabel}>OVERALL</span>
                                    </div>
                                    <div className={styles.rankItem}>
                                        <span className={styles.rankNum}>#{player.depth_chart_order || player.pos_rank || player.posRank || '-'}</span> 
                                        <span className={styles.rankLabel}>{pos} DEPTH</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.playerRankings}>
                                <h4>LEAGUE TRENDS</h4>
                                <div className={styles.rankingStats}>
                                    <div className={styles.rankItem}>
                                        <span className={styles.rankNum}>{rosterPct}</span> 
                                        <span className={styles.rankLabel}>ROSTERED</span>
                                    </div>
                                    <div className={styles.rankItem}>
                                        <span className={styles.rankNum}>{startPct}</span> 
                                        <span className={styles.rankLabel}>STARTED</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {detailedInjuryNotes && (
                    <div style={{
                        margin: '15px 20px 0 20px',
                        padding: '12px 16px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderLeft: '4px solid #ef4444',
                        borderRadius: '6px',
                        color: '#f8fafc'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontWeight: 'bold', fontSize: '0.9em', marginBottom: '4px' }}>
                            <i className="material-icons" style={{ fontSize: '18px' }}>medical_services</i>
                            <span>INJURY REPORT ({player.injStatus || 'UPDATE'})</span>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.9em', lineHeight: '1.4', color: '#cbd5e1' }}>
                            {detailedInjuryNotes}
                        </p>
                    </div>
                )}

                <div className={styles.mainContentLayout}>
                    <div className={styles.gameLogsSection}>
                        <div className={styles.sectionHeader} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                            <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>GAME LOGS</h2>
                            <div className={styles.yearTabs} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {availableYears.map(year => (
                                    <button 
                                        key={year} 
                                        className={`${styles.yearTab} ${activeYear === year ? styles.activeYear : ''}`} 
                                        style={activeYear === year ? { backgroundColor: '#eebf1c', color: '#0f172a', fontWeight: 'bold' } : {}}
                                        onClick={() => setActiveYear(year)}
                                    >
                                        {year}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.tableWrapper}>
                            <table className={styles.logsTable}>
                                <thead>
                                    <tr className={styles.superHeader}>
                                        <th colSpan="4"></th>
                                        <th colSpan="4" className={styles.categoryBorder}>RUSHING</th>
                                        <th colSpan="5" className={styles.categoryBorder}>RECEIVING</th>
                                    </tr>
                                    <tr>
                                        <th>WK</th>
                                        <th>OPP</th>
                                        <th>PROJ</th>
                                        <th>FPTS</th>
                                        <th className={styles.categoryBorder}>ATT</th>
                                        <th>YD</th>
                                        <th>YPC</th>
                                        <th>TD</th>
                                        <th className={styles.categoryBorder}>TAR</th>
                                        <th>REC</th>
                                        <th>YD</th>
                                        <th>YPT</th>
                                        <th>TD</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loadingLogs ? (
                                        <tr>
                                            <td colSpan="13" style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>
                                                Compiling native Sleeper projections...
                                            </td>
                                        </tr>
                                    ) : gameLogs.map((log, idx) => (
                                        <tr key={`row-wk-${log.wk}-${idx}`} className={log.isUpcoming ? styles.activeUpcomingRow : ''}>
                                            <td className={styles.boldCell}>{log.wk}</td>
                                            <td className={styles.boldCell}>{log.opp}</td>
                                            <td className={styles.fadedCell}>{log.proj}</td>
                                            <td className={styles.highlightCell}>{log.fpts}</td>
                                            {log.isUpcoming ? (
                                                <td colSpan="9" className={styles.upcomingText}>Yet to play</td>
                                            ) : (
                                                <>
                                                    <td className={styles.categoryBorder}>{log.att}</td>
                                                    <td>{log.yd}</td>
                                                    <td>{log.ypc}</td>
                                                    <td>{log.td}</td>
                                                    <td className={styles.categoryBorder}>{log.tar}</td>
                                                    <td>{log.rec}</td>
                                                    <td>{log.recYd}</td>
                                                    <td>{log.ypt}</td>
                                                    <td>{log.recTd}</td>
                                                </>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className={styles.newsSection}>
                        <h2>
                            LATEST NEWS 
                            {isCachedNews && <span style={{ fontSize: '0.6em', color: '#94a3b8', marginLeft: '8px', fontWeight: 'normal' }}>(Last Saved Update)</span>}
                        </h2>
                        <div className={styles.newsFeed}>
                            {loadingNews ? (
                                <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9em' }}>
                                    Syncing player updates...
                                </div>
                            ) : playerNews && playerNews.length > 0 ? (
                                playerNews.map((article) => {
                                    const CardWrapper = article.url ? 'a' : 'div';
                                    return (
                                        <CardWrapper 
                                            key={article.id} 
                                            href={article.url} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className={styles.newsCard}
                                            style={{ textDecoration: 'none', color: 'inherit', display: 'block', cursor: article.url ? 'pointer' : 'default' }}
                                        >
                                            <h3 className={styles.newsHeadline}>{article.title}</h3>
                                            <div className={styles.newsMeta}>
                                                {article.date ? `${article.date} via ` : 'via '}{article.source}
                                            </div>
                                            {article.description && (
                                                <p className={styles.newsBody}>{article.description}</p>
                                            )}
                                            {article.url && (
                                                <div style={{ marginTop: '8px', fontSize: '0.85em', color: '#eebf1c', fontWeight: 'bold' }}>
                                                    Read Full Article ↗
                                                </div>
                                            )}
                                        </CardWrapper>
                                    );
                                })
                            ) : (
                                <div className={styles.newsCard}>
                                    <h3 className={styles.newsHeadline}>{name} Outlook</h3>
                                    <div className={styles.newsMeta}>via Sleeper Status</div>
                                    <p className={styles.newsBody}>
                                        {detailedInjuryNotes || `No recent injury or transaction updates reported on the wire for ${name}.`}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}