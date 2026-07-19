import React, { useState, useEffect } from 'react';
import styles from './PlayerModal.module.css';

export default function PlayerModal({ player, onClose, week }) {
    const [activeYear, setActiveYear] = useState('2026');
    const [playerNews, setPlayerNews] = useState(null);
    const [loadingNews, setLoadingNews] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const fetchLeagueLogs = async () => {
            if (!player?.id) return;
            setLoadingNews(true);
            try {
                const res = await fetch(`https://api.leaguelogs.com/v1/players/${player.id}`);
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted) setPlayerNews(data);
                } else {
                    if (isMounted) setPlayerNews(null);
                }
            } catch (err) {
                console.error("LeagueLogs fetch failed:", err);
                if (isMounted) setPlayerNews(null);
            } finally {
                if (isMounted) setLoadingNews(false);
            }
        };

        fetchLeagueLogs();

        return () => {
            isMounted = false;
        };
    }, [player?.id]);

    if (!player) return null;
    
    const pos = player.pos || 'UNK';
    const team = player.t || 'FA';
    const name = `${player.fn} ${player.ln}`;
    const avatar = pos === 'DEF' 
        ? `https://sleepercdn.com/images/team_logos/nfl/${player.id.toLowerCase()}.png`
        : `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`;
        
    const matchup = player.wi?.[week];
    const opponent = matchup?.opp ? (matchup.opp.startsWith('@') ? matchup.opp : `vs ${matchup.opp}`) : 'BYE';
    const proj = matchup?.p ? parseFloat(matchup.p).toFixed(2) : '0.00';

    // Mock Game Logs for UI architecture (Replace with Premium API Data later)
    const mockLogs = [
        { wk: 1, opp: 'TB', proj: '19.66', fpts: '24.40', snp: '83', att: '12', yd: '24', ypc: '2.0', td: '-', tar: '7', rec: '6', recYd: '100', ypt: '14.29', recYpc: '16.67', recTd: '1' },
        { wk: 2, opp: '@MIN', proj: '18.86', fpts: '19.80', snp: '65', att: '22', yd: '143', ypc: '6.5', td: '-', tar: '5', rec: '3', recYd: '25', ypt: '5.0', recYpc: '8.33', recTd: '-' },
        { wk: 3, opp: '@CAR', proj: '20.21', fpts: '16.10', snp: '80', att: '13', yd: '72', ypc: '5.54', td: '-', tar: '6', rec: '5', recYd: '39', ypt: '6.5', recYpc: '7.8', recTd: '-' },
        { wk: 4, opp: 'WAS', proj: '19.14', fpts: '28.10', snp: '69', att: '17', yd: '75', ypc: '4.41', td: '1', tar: '5', rec: '4', recYd: '106', ypt: '21.2', recYpc: '26.5', recTd: '-' },
    ];

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                <button className={styles.closeBtn} onClick={onClose}>
                    <i className="material-icons">close</i>
                </button>
                
                {/* TOP HERO BANNER */}
                <div className={styles.heroBanner}>
                    <div className={styles.heroLeft}>
                        <div 
                            className={styles.playerImage} 
                            style={{ backgroundImage: `url(${avatar}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}
                        >
                            <div className={styles.teamBadgeWrapper}>
                                <div className={styles.posBadge}>{pos}</div>
                                <div className={styles.teamText}>{team}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div className={styles.heroRight}>
                        <h1 className={styles.playerName}>{name}</h1>
                        
                        <div className={styles.bioGrid}>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>AGE</span>
                                <span className={styles.bioValue}>24</span>
                            </div>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>HEIGHT</span>
                                <span className={styles.bioValue}>5'11"</span>
                            </div>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>WEIGHT</span>
                                <span className={styles.bioValue}>215 <span className={styles.bioSub}>lbs</span></span>
                            </div>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>EXP</span>
                                <span className={styles.bioValue}>3</span>
                            </div>
                            <div className={styles.bioStat}>
                                <span className={styles.bioLabel}>COLLEGE</span>
                                <span className={styles.bioValue}>Texas</span>
                            </div>
                        </div>

                        <div className={styles.rankingsHeader}>PLAYER RANKINGS</div>
                        <div className={styles.rankingsRow}>
                            <div className={styles.rankItem}><strong>#2</strong> {pos}</div>
                            <div className={styles.rankItem}><strong>#4</strong> OVERALL</div>
                            <div className={styles.rankItem}><strong>100%</strong> ROSTERED</div>
                            <div className={styles.rankItem}><strong>100%</strong> STARTED</div>
                        </div>
                    </div>
                </div>

                {/* MAIN CONTENT SPLIT */}
                <div className={styles.mainContentLayout}>
                    
                    {/* LEFT COLUMN: GAME LOGS */}
                    <div className={styles.gameLogsSection}>
                        <div className={styles.sectionHeader}>
                            <h2>GAME LOGS</h2>
                            <div className={styles.yearTabs}>
                                {['2026', '2025', '2024', '2023'].map(year => (
                                    <button 
                                        key={year} 
                                        className={`${styles.yearTab} ${activeYear === year ? styles.activeYear : ''}`}
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
                                    {mockLogs.map(log => (
                                        <tr key={log.wk}>
                                            <td className={styles.boldCell}>{log.wk}</td>
                                            <td className={styles.boldCell}>{log.opp}</td>
                                            <td className={styles.fadedCell}>{log.proj}</td>
                                            <td className={styles.highlightCell}>{log.fpts}</td>
                                            <td className={styles.categoryBorder}>{log.att}</td>
                                            <td>{log.yd}</td>
                                            <td>{log.ypc}</td>
                                            <td>{log.td}</td>
                                            <td className={styles.categoryBorder}>{log.tar}</td>
                                            <td>{log.rec}</td>
                                            <td>{log.recYd}</td>
                                            <td>{log.ypt}</td>
                                            <td>{log.recTd}</td>
                                        </tr>
                                    ))}
                                    {/* Active Week Row injected from Sleeper Projections API context */}
                                    <tr className={styles.activeUpcomingRow}>
                                        <td className={styles.boldCell}>{week}</td>
                                        <td className={styles.boldCell}>{opponent}</td>
                                        <td className={styles.fadedCell}>{proj}</td>
                                        <td className={styles.highlightCell}>-</td>
                                        <td colSpan="9" className={styles.upcomingText}>Upcoming Matchup</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: NEWS */}
                    <div className={styles.newsSection}>
                        <h2>LATEST NEWS</h2>
                        <div className={styles.newsFeed}>
                            {loadingNews ? (
                                <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9em' }}>
                                    Fetching latest updates from LeagueLogs...
                                </div>
                            ) : playerNews?.status_blurb ? (
                                <div className={styles.newsCard}>
                                    <h3 className={styles.newsHeadline}>Player Update</h3>
                                    <div className={styles.newsMeta}>
                                        via <a href="https://leaguelogs.com" target="_blank" rel="noopener noreferrer" style={{ color: '#eebf1c', textDecoration: 'none' }}>LeagueLogs</a>
                                    </div>
                                    <p className={styles.newsBody}>{playerNews.status_blurb}</p>
                                </div>
                            ) : (
                                /* Fallback if LeagueLogs has no current blurbs for this player */
                                <div className={styles.newsCard}>
                                    <h3 className={styles.newsHeadline}>{name} Outlook</h3>
                                    <div className={styles.newsMeta}>via Huddle FF</div>
                                    <p className={styles.newsBody}>
                                        No recent breaking news or status blurbs found for {name} on the wire. Check back later for injury or transaction signals.
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