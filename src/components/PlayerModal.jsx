import React, { useState, useEffect } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueData } from '../utils/helper';
import styles from './PlayerModal.module.css';

export default function PlayerModal({ player, week = 1, onClose }) {
    const { activeLeague } = useLeague();
    const [leagueData, setLeagueData] = useState(null);
    const [activeTab, setActiveTab] = useState('gamelog'); 
    
    const currentYear = new Date().getFullYear();
    const [selectedGameLogYear, setSelectedGameLogYear] = useState(currentYear);
    
    const [gameLogs, setGameLogs] = useState({});
    const [gameProjs, setGameProjs] = useState({});
    const [seasonStats, setSeasonStats] = useState({});
    const [yearsPlayed, setYearsPlayed] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(true);

    if (!player) return null;

    const pId = player.player_id || player.id;
    const pos = (player.pos || player.position || 'BN').toUpperCase();
    const firstName = player.fn || player.first_name || '';
    const lastName = player.ln || player.last_name || '';
    const number = player.number ? `#${player.number}` : '';

    const normalizeTeam = (t) => {
        if (!t) return '';
        const map = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', NOH: 'NO' };
        const upper = String(t).toUpperCase();
        return map[upper] || upper;
    };

    const team = normalizeTeam(player.t || player.team || 'FA');

    // 1. Initial Load of League Data & Season History
    useEffect(() => {
        let isMounted = true;
        if (!pId || !activeLeague?.sleeper_league_id) return;

        getLeagueData(activeLeague.sleeper_league_id).then(lData => {
            if (!isMounted) return;
            setLeagueData(lData);
            
            const season = lData?.season || currentYear;
            setSelectedGameLogYear(season);

            const exp = parseInt(player.years_exp ?? player.exp) || 0;
            const yearsToFetch = [];
            for (let i = 0; i <= exp && i < 6; i++) { 
                yearsToFetch.push(parseInt(season) - i);
            }
            setYearsPlayed(yearsToFetch);

            Promise.all(yearsToFetch.map(y => 
                fetch(`https://api.sleeper.com/stats/nfl/player/${pId}?season_type=regular&season=${y}&grouping=season`)
                    .then(res => res.ok ? res.json() : {})
                    .then(data => ({ year: y, data: data || {} }))
                    .catch(() => ({ year: y, data: {} }))
            )).then(results => {
                if (!isMounted) return;
                const sStats = {};
                results.forEach(r => { 
                    const raw = r.data || {};
                    sStats[r.year] = raw[r.year] || raw; 
                });
                setSeasonStats(sStats);
            });
        });

        return () => { isMounted = false; };
    }, [pId, activeLeague, player.years_exp, player.exp, currentYear]);

    // 2. Fetch Game Logs & Projections for Selected Year
    useEffect(() => {
        let isMounted = true;
        if (!pId) return;

        setLoadingLogs(true);

        const logsPromise = fetch(`https://api.sleeper.com/stats/nfl/player/${pId}?season_type=regular&season=${selectedGameLogYear}&grouping=week`)
            .then(res => res.ok ? res.json() : {})
            .catch(() => ({}));

        const projsPromise = fetch(`https://api.sleeper.com/projections/nfl/player/${pId}?season_type=regular&season=${selectedGameLogYear}&grouping=week`)
            .then(res => res.ok ? res.json() : {})
            .catch(() => ({}));

        Promise.all([logsPromise, projsPromise]).then(([logsData, projsData]) => {
            if (!isMounted) return;
            setGameLogs(logsData || {});
            setGameProjs(projsData || {});
            setLoadingLogs(false);
        });

        return () => { isMounted = false; };
    }, [pId, selectedGameLogYear]);

    const getAvatar = () => pos === 'DEF' 
        ? `https://sleepercdn.com/images/team_logos/nfl/${pId.toLowerCase()}.png` 
        : `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;

    const formatHeight = (ht) => {
        if (!ht) return "--";
        if (typeof ht === 'string' && ht.includes("'")) return ht;
        const inches = parseInt(ht);
        if (isNaN(inches)) return ht;
        return `${Math.floor(inches / 12)}'${inches % 12}"`;
    };

    const handleOverlayClick = (e) => {
        if (e.target.classList.contains(styles.overlay)) onClose();
    };

    const calcCustomPts = (rawStatsObj) => {
        if (!rawStatsObj || Object.keys(rawStatsObj).length === 0) return '-';
        const s = rawStatsObj.stats || rawStatsObj; 
        const scoringSettings = leagueData?.scoring_settings || {};
        
        let customPts = 0;
        let hasValidStats = false;

        for (const [statKey, statMultiplier] of Object.entries(scoringSettings)) {
            if (s[statKey] !== undefined && typeof s[statKey] === 'number') {
                customPts += (s[statKey] * statMultiplier);
                hasValidStats = true;
            }
        }

        if (pos === 'TE' && scoringSettings.bonus_rec_te && s.rec !== undefined) {
            customPts += (s.rec * scoringSettings.bonus_rec_te);
        }

        if (hasValidStats) return customPts.toFixed(1);
        
        if (s.pts_ppr !== undefined) return parseFloat(s.pts_ppr).toFixed(1);
        if (s.pts_half_ppr !== undefined) return parseFloat(s.pts_half_ppr).toFixed(1);
        if (s.pts_std !== undefined) return parseFloat(s.pts_std).toFixed(1);

        return '-';
    };

    const getOpponentDisplay = (rawData) => {
        if (!rawData || !rawData.opponent) return '-';
        if (String(rawData.opponent).toUpperCase() === 'BYE') return 'BYE';
        const opp = normalizeTeam(rawData.opponent);
        return `vs ${opp}`;
    };

    const formatStat = (val) => {
        if (val === undefined || val === null) return '-';
        if (typeof val === 'number') return Number.isInteger(val) ? val : parseFloat(val).toFixed(1);
        return val;
    };

    // --- TABLE CONFIGURATION ---
    const isQB = pos === 'QB';
    const isFlex = pos === 'RB' || pos === 'WR' || pos === 'TE';
    
    const statGroups = [];
    if (isQB) {
        statGroups.push({ name: 'PASS', cols: [{label: 'ATT', key: 'pass_att'}, {label: 'CMP', key: 'pass_cmp'}, {label: 'YD', key: 'pass_yd'}, {label: 'TD', key: 'pass_td'}] });
        statGroups.push({ name: 'RUSH', cols: [{label: 'ATT', key: 'rush_att'}, {label: 'YD', key: 'rush_yd'}, {label: 'TD', key: 'rush_td'}] });
    } else if (isFlex) {
        statGroups.push({ name: 'RUSH', cols: [{label: 'ATT', key: 'rush_att'}, {label: 'YD', key: 'rush_yd'}, {label: 'TD', key: 'rush_td'}] });
        statGroups.push({ name: 'REC', cols: [{label: 'REC', key: 'rec'}, {label: 'TGT', key: 'rec_tgt'}, {label: 'YD', key: 'rec_yd'}, {label: 'TD', key: 'rec_td'}] });
    } else if (pos === 'K') {
        statGroups.push({ name: 'KICK', cols: [{label: 'FG', key: 'fgm'}, {label: 'FGA', key: 'fga'}, {label: 'XP', key: 'xpm'}, {label: 'XPA', key: 'xpa'}] });
    } else if (pos === 'DEF') {
        statGroups.push({ name: 'DEF', cols: [{label: 'SACK', key: 'sack'}, {label: 'INT', key: 'int'}, {label: 'FR', key: 'fum_rec'}, {label: 'FF', key: 'ff'}, {label: 'TD', key: 'def_td'}] });
    } else {
        statGroups.push({ name: 'MISC', cols: [{label: 'PTS', key: 'pts_ppr'}, {label: 'YDS', key: 'yd'}] });
    }

    const getOppColor = (opp) => {
        if (!opp || opp === 'BYE' || opp === '-') return '#f8fafc';
        const text = opp.replace(/[@vs\s]/gi, '');
        const charCode = text.charCodeAt(0) || 0;
        if (charCode % 3 === 0) return '#ef4444'; 
        if (charCode % 3 === 1) return '#00ceb8'; 
        return '#eebf1c'; 
    };

    const currentWeekProj = gameProjs[week] || {};
    const projPtsDisplay = calcCustomPts(currentWeekProj);
    const upcomingOppDisplay = getOpponentDisplay(currentWeekProj);

    return (
        <div className={styles.overlay} onClick={handleOverlayClick}>
            <div className={styles.modalCard}>
                
                {player.inj_status && (
                    <div className={styles.injuryBanner}>
                        <i className="material-icons">help_outline</i>
                        <span>{player.inj_status.toUpperCase()}</span>
                    </div>
                )}

                <div className={styles.heroHeader}>
                    <div className={styles.heroLeft}>
                        <div 
                            className={styles.playerAvatar} 
                            style={{ backgroundImage: `url(${getAvatar()}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}
                        ></div>
                        <div className={styles.teamTag}>
                            <span className={styles.teamNameText}>{team}</span>
                            <span className={styles.posSubText} style={{ color: `var(--${pos})` }}>{pos}</span>
                            <span className={styles.posSubText}> • {team} {number}</span>
                        </div>
                    </div>

                    <div className={styles.heroRight}>
                        <div className={styles.nameGroup}>
                            <span className={styles.fnText}>{firstName}</span>
                            <h2 className={styles.lnText}>{lastName}</h2>
                        </div>

                        <div className={styles.traitsGrid}>
                            <div className={styles.traitBox}>
                                <span className={styles.traitLabel}>AGE</span>
                                <span className={styles.traitVal}>{player.age || '--'}</span>
                            </div>
                            <div className={styles.traitBox}>
                                <span className={styles.traitLabel}>HEIGHT</span>
                                <span className={styles.traitVal}>{formatHeight(player.height || player.ht)}</span>
                            </div>
                            <div className={styles.traitBox}>
                                <span className={styles.traitLabel}>WEIGHT</span>
                                <span className={styles.traitVal}>{(player.weight || player.wt) ? `${player.weight || player.wt} lbs` : '--'}</span>
                            </div>
                            <div className={styles.traitBox}>
                                <span className={styles.traitLabel}>EXP</span>
                                <span className={styles.traitVal}>{player.years_exp ?? player.exp ?? '0'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.navTabs}>
                    <button className={`${styles.tabBtn} ${activeTab === 'summary' ? styles.activeTab : ''}`} onClick={() => setActiveTab('summary')}>SUMMARY</button>
                    <button className={`${styles.tabBtn} ${activeTab === 'gamelog' ? styles.activeTab : ''}`} onClick={() => setActiveTab('gamelog')}>GAME LOG</button>
                    <button className={`${styles.tabBtn} ${activeTab === 'stats' ? styles.activeTab : ''}`} onClick={() => setActiveTab('stats')}>STATS</button>
                </div>

                <div className={styles.modalBody}>
                    
                    {activeTab === 'summary' && (
                        <div className={styles.summaryTab}>
                            <div className={styles.sectionTitle}>UPCOMING GAME</div>
                            <div className={styles.upcomingCard}>
                                <div className={styles.upcomingHeader}>
                                    <span className={styles.weekTag}>WEEK {week}</span>
                                </div>
                                <div className={styles.upcomingMatchupRow}>
                                    <div className={styles.playerMetaMini}>
                                        <div className={styles.miniAvatar} style={{ backgroundImage: `url(${getAvatar()})` }}></div>
                                        <div className={styles.miniTextGroup}>
                                            <span className={styles.shortName}>{firstName.charAt(0)}. {lastName}</span>
                                            <span className={styles.oppText}>{upcomingOppDisplay === '-' ? 'TBD' : upcomingOppDisplay}</span>
                                        </div>
                                    </div>
                                    <div className={styles.projScoreBadge}>
                                        <span className={styles.projVal}>{projPtsDisplay}</span>
                                        <span className={styles.projSubLabel}>proj</span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* PREMIUM NOTICE */}
                            <div className={styles.premiumNotice}>
                                <i className="material-icons">workspace_premium</i>
                                <div className={styles.premiumText}>
                                    <span className={styles.premiumTitle}>Custom Player Profiles</span>
                                    <span className={styles.premiumDesc}>Premium feature in the works. ETA 2027 Season.</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'gamelog' && (
                        <div className={styles.tableWrapper}>
                            
                            {/* BLOCKY YEAR FILTER BUTTONS */}
                            {yearsPlayed.length > 0 && (
                                <div className={styles.yearFilterBar}>
                                    {yearsPlayed.map(y => (
                                        <button 
                                            key={y} 
                                            className={`${styles.yearBtn} ${selectedGameLogYear === y ? styles.activeYearBtn : ''}`}
                                            onClick={() => setSelectedGameLogYear(y)}
                                        >
                                            {y}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {loadingLogs ? (
                                <div className={styles.loadingText}>Loading Game Logs...</div>
                            ) : (
                                <table className={styles.gameLogTable}>
                                    <thead>
                                        <tr>
                                            <th></th>
                                            <th></th>
                                            <th colSpan="3" className={styles.groupHeader}>FANTASY</th>
                                            {statGroups.map(g => (
                                                <th key={g.name} colSpan={g.cols.length} className={styles.groupHeader}>{g.name}</th>
                                            ))}
                                        </tr>
                                        <tr>
                                            <th className={styles.colHeaderLeft}>WK</th>
                                            <th className={styles.colHeaderLeft}>OPP</th>
                                            <th className={styles.colHeader}>FPTS</th>
                                            <th className={styles.colHeader}>SNP%</th>
                                            <th className={styles.colHeader}>RANK</th>
                                            {statGroups.flatMap(g => g.cols.map(c => (
                                                <th key={`${g.name}-${c.label}`} className={styles.colHeader}>{c.label}</th>
                                            )))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...Array(18).keys()].map(i => {
                                            const w = i + 1;
                                            
                                            const log = gameLogs[w];
                                            const proj = gameProjs[w];
                                            
                                            const schedData = (log && log.opponent) ? log : proj;
                                            const oppDisplay = getOpponentDisplay(schedData);
                                            const isBye = oppDisplay === 'BYE';
                                            
                                            const s = log?.stats || log || {};
                                            const hasPlayed = Object.keys(s).length > 0 && (s.pts_ppr !== undefined || s.gp !== undefined || s.pass_att !== undefined);
                                            
                                            const fpts = hasPlayed ? calcCustomPts(log) : '-';
                                            const snp = (hasPlayed && s.off_snp_pct !== undefined) ? `${s.off_snp_pct}%` : '-';
                                            
                                            return (
                                                <tr key={w}>
                                                    <td className={styles.wkCol}>{w}</td>
                                                    <td className={styles.oppCol} style={{ color: getOppColor(oppDisplay) }}>{oppDisplay}</td>
                                                    {isBye ? (
                                                        <td colSpan={3 + statGroups.reduce((acc, g) => acc + g.cols.length, 0)} className={styles.byeCell}></td>
                                                    ) : (
                                                        <>
                                                            <td className={styles.statCell}>{fpts}</td>
                                                            <td className={styles.statCell}>{snp}</td>
                                                            <td className={styles.statCell}>-</td>
                                                            {statGroups.flatMap(g => g.cols.map(c => (
                                                                <td key={`cell-${w}-${c.key}`} className={styles.statCell}>
                                                                    {hasPlayed ? formatStat(s[c.key]) : '-'}
                                                                </td>
                                                            )))}
                                                        </>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                    {activeTab === 'stats' && (
                        <div className={styles.tableWrapper}>
                            <table className={styles.gameLogTable}>
                                <thead>
                                    <tr>
                                        <th></th>
                                        <th></th>
                                        <th colSpan="3" className={styles.groupHeader}>FANTASY</th>
                                        {statGroups.map(g => (
                                            <th key={g.name} colSpan={g.cols.length} className={styles.groupHeader}>{g.name}</th>
                                        ))}
                                    </tr>
                                    <tr>
                                        <th className={styles.colHeaderLeft}>YR</th>
                                        <th className={styles.colHeaderLeft}>TM</th>
                                        <th className={styles.colHeader}>FPTS</th>
                                        <th className={styles.colHeader}>SNP%</th>
                                        <th className={styles.colHeader}>RANK</th>
                                        {statGroups.flatMap(g => g.cols.map(c => (
                                            <th key={`${g.name}-${c.label}`} className={styles.colHeader}>{c.label}</th>
                                        )))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {yearsPlayed.map(yr => {
                                        const statsObj = seasonStats[yr] || {};
                                        const s = statsObj.stats || statsObj;
                                        
                                        const fpts = calcCustomPts(statsObj);
                                        const snp = s.off_snp_pct !== undefined ? `${s.off_snp_pct}%` : '-';

                                        return (
                                            <tr key={yr}>
                                                <td className={styles.wkCol}>{yr}</td>
                                                <td className={styles.oppCol} style={{ color: '#f8fafc' }}>{team}</td>
                                                <td className={styles.statCell}>{fpts}</td>
                                                <td className={styles.statCell}>{snp}</td>
                                                <td className={styles.statCell}>-</td>
                                                {statGroups.flatMap(g => g.cols.map(c => (
                                                    <td key={`stat-${yr}-${c.key}`} className={styles.statCell}>
                                                        {formatStat(s[c.key])}
                                                    </td>
                                                )))}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                </div>

                <button className={styles.floatingCloseBtn} onClick={onClose}>
                    <i className="material-icons">close</i>
                </button>
            </div>
        </div>
    );
}