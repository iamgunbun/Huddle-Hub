import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { loadPlayers, getLeagueData, getNflState } from '../utils/helper';
import { scoreStatLine } from '../utils/yahooScoring';
import styles from './StartSit.module.css';

const NFL_TEAMS = new Set([
    'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB',
    'HOU','IND','JAX','KC','LV','LAC','LAR','MIA','MIN','NE','NO','NYG',
    'NYJ','PHI','PIT','SF','SEA','TB','TEN','WAS'
]);

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

export default function StartSit() {
    const { activeLeague, isPremium, setShowPremiumModal } = useLeague();
    const [loading, setLoading] = useState(true);
    const [playersInfo, setPlayersInfo] = useState({});
    const [leagueData, setLeagueData] = useState(null);
    const [activeWeek, setActiveWeek] = useState(1);
    
    // Live API State
    const [weeklyProjections, setWeeklyProjections] = useState({});
    const [weeklyStats, setWeeklyStats] = useState({}); 
    const [nflScheduleMap, setNflScheduleMap] = useState({});
    
    // Player Selection State
    const [playerA, setPlayerA] = useState(null);
    const [playerB, setPlayerB] = useState(null);
    const [isSearchOpen, setIsSearchOpen] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Analysis State
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [uiErrorMessage, setUiErrorMessage] = useState(null);

    const normalizeTeam = (t) => {
        if (!t) return '';
        const map = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', NOH: 'NO' };
        const upper = String(t).toUpperCase();
        return map[upper] || upper;
    };

    const getPlayerObj = (pId) => {
        if (!pId || pId === "0") return null;
        return playersInfo[pId] || playersInfo[String(pId)] || playersInfo[Number(pId)] || null;
    };

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [pData, lData, nflState] = await Promise.all([
                    loadPlayers(activeLeague.sleeper_league_id),
                    getLeagueData(activeLeague.sleeper_league_id),
                    getNflState().catch(() => null)
                ]);

                if (!isMounted) return;
                const playersMap = pData?.players || pData || {};
                setPlayersInfo(playersMap);
                setLeagueData(lData);

                const fetchedSeason = lData?.season || activeLeague?.season || new Date().getFullYear();
                // The real NFL week, not a platform-specific field -- Sleeper's
                // league object carries no "current week" field of its own either
                // (that lived on `settings.leg`, which Yahoo leagues never have),
                // so both platforms are better served by asking what week it
                // actually is right now than by reading a field that silently
                // doesn't exist for one of them.
                let fetchedWeek = 1;
                if (nflState?.season_type === 'regular') fetchedWeek = nflState.display_week || nflState.week || 1;
                else if (nflState?.season_type === 'post') fetchedWeek = 18;
                setActiveWeek(fetchedWeek);

                fetch(`https://api.sleeper.com/projections/nfl/${fetchedSeason}/${fetchedWeek}?season_type=regular`)
                    .then(res => res.json())
                    .then(data => {
                        if (isMounted) {
                            if (Array.isArray(data)) {
                                const map = {};
                                data.forEach(item => { if (item.player_id) map[item.player_id] = item; });
                                setWeeklyProjections(map);
                            } else {
                                setWeeklyProjections(data || {});
                            }
                        }
                    })
                    .catch(e => console.error(e));

                fetch(`https://api.sleeper.com/stats/nfl/${fetchedSeason}/${fetchedWeek}?season_type=regular`)
                    .then(res => res.json())
                    .then(data => {
                        if (isMounted) {
                            if (Array.isArray(data)) {
                                const map = {};
                                data.forEach(item => { if (item.player_id) map[item.player_id] = item; });
                                setWeeklyStats(map);
                            } else {
                                setWeeklyStats(data || {});
                            }
                        }
                    })
                    .catch(e => console.error(e));

                fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${fetchedWeek}&dates=${fetchedSeason}`)
                    .then(res => res.json())
                    .then(data => {
                        if (isMounted && data?.events) {
                            const map = {};
                            data.events.forEach(event => {
                                const comp = event.competitions?.[0];
                                if (comp && comp.competitors) {
                                    const homeTeam = comp.competitors.find(c => c.homeAway === 'home')?.team?.abbreviation;
                                    const awayTeam = comp.competitors.find(c => c.homeAway === 'away')?.team?.abbreviation;
                                    
                                    if (homeTeam && awayTeam) {
                                        const home = normalizeTeam(homeTeam);
                                        const away = normalizeTeam(awayTeam);
                                        map[home] = `VS ${away}`;
                                        map[away] = `@ ${home}`; 
                                    }
                                }
                            });
                            setNflScheduleMap(map);
                        }
                    })
                    .catch(err => console.error("ESPN Schedule fetch err:", err));
                
            } catch (e) { 
                console.error("Failed to load engine data:", e); 
            } finally { 
                if (isMounted) setLoading(false); 
            }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim() || !playersInfo) return [];
        const q = searchQuery.toLowerCase().trim();
        const validPositions = new Set(['QB', 'RB', 'WR', 'TE', 'DEF', 'K']);
        
        return Object.values(playersInfo)
            .filter(p => {
                if (!p) return false;

                const pos = p.pos || p.position || (p.fantasy_positions && p.fantasy_positions[0]);
                if (!validPositions.has(pos)) return false;
                
                if (p.active === false || p.status === 'Inactive' || p.status === 'Retired') return false;
                
                const team = (p.team || p.t || '').toUpperCase();
                if (!NFL_TEAMS.has(team) && pos !== 'DEF') return false;

                const firstName = (p.fn || p.first_name || '').toLowerCase();
                const lastName = (p.ln || p.last_name || '').toLowerCase();
                const fullName = `${firstName} ${lastName}`.trim();

                return firstName.includes(q) || lastName.includes(q) || fullName.includes(q);
            })
            .sort((a, b) => (a.search_rank || 99999) - (b.search_rank || 99999))
            .slice(0, 25);
    }, [searchQuery, playersInfo]);

    const handleSelectPlayer = (player) => {
        if (isSearchOpen === 'A') setPlayerA(player);
        if (isSearchOpen === 'B') setPlayerB(player);
        setIsSearchOpen(null);
        setSearchQuery('');
        setAnalysisResult(null);
        setUiErrorMessage(null);
    };

    const getAvatar = (p) => {
        if (!p) return 'https://sleepercdn.com/images/v2/icons/player_default.webp';
        const pos = p.pos || p.position;
        const pId = p.player_id || p.id;
        
        if (pos === 'DEF') {
            const team = p.team || p.t || pId;
            return `https://sleepercdn.com/images/team_logos/nfl/${String(team).toLowerCase()}.png`;
        }
        return `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;
    };

    const getMatchupOpp = (pId) => {
        const playerObj = getPlayerObj(pId);
        const proj = weeklyProjections[pId];
        const stats = weeklyStats[pId];
        
        if (!playerObj && !proj && !stats) return '';

        const team = normalizeTeam(playerObj?.t || playerObj?.team);

        if (team && nflScheduleMap[team]) {
            return nflScheduleMap[team];
        }

        let rawOpp = playerObj?.wi?.[activeWeek]?.opp || stats?.opponent || proj?.opponent || '';

        if (!rawOpp || rawOpp === '-' || rawOpp === 'BYE') return 'BYE';

        let isAway = rawOpp.includes('@');
        let cleanOpp = rawOpp.replace(/[@]/g, '').replace(/vs\.?/gi, '').trim().toUpperCase();

        return isAway ? `@ ${cleanOpp}` : `VS ${cleanOpp}`;
    };

    const getPlayerProjPts = (pId) => {
        if (!pId || pId === "0") return '0.00';
        const playerObj = playersInfo[pId];
        // Sleeper's feeds are keyed by Sleeper ids; a Yahoo league's roster ids
        // are Yahoo's, so fall back to the crosswalked sleeper_id.
        const sleeperKey = playerObj?.sleeper_id;
        const proj = weeklyProjections[pId] || weeklyStats[pId]
            || (sleeperKey ? (weeklyProjections[sleeperKey] || weeklyStats[sleeperKey]) : null);
        const scoringSettings = leagueData?.scoring_settings || {};

        if (proj) {
            const stats = proj.stats || proj || {};
            // Shared, tested scorer -- applies this league's rules including
            // defense points-allowed tiers and kicker field-goal distances.
            const scored = scoreStatLine(stats, scoringSettings, playerObj?.pos);
            if (scored !== null) return scored.toFixed(2);

            const rec = scoringSettings.rec || 0;
            let key = 'pts_std';
            if (rec === 1) key = 'pts_ppr';
            else if (rec === 0.5) key = 'pts_half_ppr';

            const basePts = stats[key] || proj[key] || 0;
            if (basePts > 0) return parseFloat(basePts).toFixed(2);
        }

        const cachePts = playerObj?.wi?.[activeWeek]?.p ? parseFloat(playerObj.wi[activeWeek].p) : 0;
        return cachePts > 0 ? cachePts.toFixed(2) : '0.00';
    };

    const getRawProjStat = (pId, statKey) => {
        const proj = weeklyProjections[pId] || weeklyStats[pId];
        if (!proj) return 0;
        const stats = proj.stats || proj || {};
        
        if (statKey === 'any_td') {
            return (stats.pass_td || 0) + (stats.rush_td || 0) + (stats.rec_td || 0);
        }
        return stats[statKey] || 0;
    };

    const formatStat = (val) => {
        if (val === undefined || val === null) return '-';
        if (Number(val) === 0) return '0.0'; 
        return Number(val) % 1 === 0 ? val : Number(val).toFixed(1);
    };

    const renderStatRow = (label, statKey) => {
        if (!playerA || !playerB) return null;

        const pIdA = playerA.player_id || playerA.id;
        const pIdB = playerB.player_id || playerB.id;

        let valA_raw = 0;
        let valB_raw = 0;

        if (statKey === 'pts_custom') {
            valA_raw = parseFloat(getPlayerProjPts(pIdA));
            valB_raw = parseFloat(getPlayerProjPts(pIdB));
        } else {
            valA_raw = getRawProjStat(pIdA, statKey);
            valB_raw = getRawProjStat(pIdB, statKey);
        }

        const isAWinner = valA_raw > valB_raw && valA_raw > 0;
        const isBWinner = valB_raw > valA_raw && valB_raw > 0;

        return (
            <div className={styles.statRow} key={statKey}>
                <div className={`${styles.statVal} ${styles.left} ${isAWinner ? styles.win : ''}`}>
                    {statKey === 'pts_custom' && valA_raw > 0 ? valA_raw.toFixed(2) : formatStat(valA_raw)}
                </div>
                <div className={styles.statLabel}>{label}</div>
                <div className={`${styles.statVal} ${styles.right} ${isBWinner ? styles.win : ''}`}>
                    {statKey === 'pts_custom' && valB_raw > 0 ? valB_raw.toFixed(2) : formatStat(valB_raw)}
                </div>
            </div>
        );
    };

    const runMatchupAnalysis = async () => {
        // --- PAYWALL CHECK FIRES IMMEDIATELY ---
        if (!isPremium) {
            setShowPremiumModal(true);
            return;
        }

        if (!playerA || !playerB) {
            alert("Please select Player A and Player B first.");
            return;
        }

        setIsAnalyzing(true);
        setAnalysisResult(null);
        setUiErrorMessage(null);

        const pIdA = playerA.player_id || playerA.id;
        const nameA = `${playerA.fn || playerA.first_name || ''} ${playerA.ln || playerA.last_name || ''}`.trim();
        const posA = playerA.pos || playerA.position;
        const teamA = (playerA.team || playerA.t || 'FA').toUpperCase();
        const oppA = getMatchupOpp(pIdA);
        const projA = parseFloat(getPlayerProjPts(pIdA));

        const pIdB = playerB.player_id || playerB.id;
        const nameB = `${playerB.fn || playerB.first_name || ''} ${playerB.ln || playerB.last_name || ''}`.trim();
        const posB = playerB.pos || playerB.position;
        const teamB = (playerB.team || playerB.t || 'FA').toUpperCase();
        const oppB = getMatchupOpp(pIdB);
        const projB = parseFloat(getPlayerProjPts(pIdB));

        // Array of analytical angles to randomly inject variety into responses
        const analyticalPerspectives = [
            "Focus heavily on Floor vs. Ceiling volatility, assessing risk tolerance for fantasy managers.",
            "Analyze through the lens of Game Script, expected team pacing, and projected point total / game flow.",
            "Prioritize matchup metrics, trench play, defensive DVOA, and position-specific coverage trends.",
            "Take a contrarian fantasy analyst perspective, highlighting hidden red flags and workload traps.",
            "Emphasize recent usage trends, target/carries share, and high-value touch opportunities (red zone/goal line)."
        ];

        const selectedAngle = analyticalPerspectives[Math.floor(Math.random() * analyticalPerspectives.length)];

        const pipelinePrompt = `
            You are an elite, highly engaging NFL fantasy football analyst. Evaluate this Week ${activeWeek} Start/Sit decision for the ${leagueData?.season || 2026} season using custom league scoring settings.
            
            PLAYER A: ${nameA} (${posA} - ${teamA})
            - Matchup: ${oppA}
            - Projected Custom FPTS: ${projA.toFixed(2)}

            PLAYER B: ${nameB} (${posB} - ${teamB})
            - Matchup: ${oppB}
            - Projected Custom FPTS: ${projB.toFixed(2)}

            ANALYTICAL ANGLE FOR THIS EVALUATION: ${selectedAngle}

            YOUR TASK:
            1. Evaluate both players with fresh, natural, and varied writing. Avoid repetitive cookie-cutter introductory formulas.
            2. Explicitly reference their specific opponents (${oppA} and ${oppB}) and key matchup factors.
            3. Provide a clear, definitive recommendation on who to start and why.

            Return strictly in JSON format:
            {
                "recommendedId": "${pIdA} or ${pIdB}",
                "confidence": 85,
                "verdict": "Start [Winner Name]",
                "reasoning": "A compelling, sharp 4-5 sentence analysis focusing on the assigned analytical angle (${selectedAngle}). Must mention both players' opponents, key game conditions/matchups, and why the recommended player offers the superior fantasy outcome this week."
            }
        `;
        
        try {
            const response = await fetch('/api/evaluate-start-sit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: pipelinePrompt })
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({}));
                throw new Error(errJson.error || `Server API error ${response.status}`);
            }

            const data = await response.json();
            const rawResponseText = data.evaluation ? data.evaluation : JSON.stringify(data);
            const parsedData = parseAiResponse(rawResponseText);
            setAnalysisResult(parsedData);

        } catch (error) {
            console.error("Verdict Generation Error:", error);
            setUiErrorMessage(error.message || "Failed to process the evaluation pipeline.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    if (loading) return <div className={styles.loading}>Loading Engine...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Start / Sit</h1>
                <p className={styles.subtitle}>Smart Lineup Optimizer</p>
            </div>

            <div className={styles.arena}>
                {/* Slot A */}
                <div 
                    className={`${styles.playerSlot} ${playerA ? styles.filledSlot : styles.emptySlot}`}
                    onClick={() => setIsSearchOpen('A')}
                >
                    {playerA ? (
                        <>
                            <div className={styles.avatarWrapper}>
                                <img 
                                    src={getAvatar(playerA)} 
                                    alt="A" 
                                    className={styles.slotAvatar} 
                                    onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }}
                                />
                            </div>
                            <div className={styles.slotMeta}>
                                <span className={styles.slotName}>{playerA.fn || playerA.first_name} {playerA.ln || playerA.last_name}</span>
                                <span className={styles.slotDetails}>
                                    {playerA.pos || playerA.position} • {playerA.team || playerA.t} {getMatchupOpp(playerA.player_id || playerA.id) !== 'BYE' ? `(${getMatchupOpp(playerA.player_id || playerA.id)})` : ''}
                                </span>
                            </div>
                            <button className={styles.swapBtn} onClick={(e) => { e.stopPropagation(); setPlayerA(null); setAnalysisResult(null); }}>
                                <i className="material-icons">close</i>
                            </button>
                        </>
                    ) : (
                        <div className={styles.emptyContent}>
                            <i className="material-icons">person_add</i>
                            <span>Select Player A</span>
                        </div>
                    )}
                </div>

                <div className={styles.vsBadge}>VS</div>

                {/* Slot B */}
                <div 
                    className={`${styles.playerSlot} ${playerB ? styles.filledSlot : styles.emptySlot}`}
                    onClick={() => setIsSearchOpen('B')}
                >
                    {playerB ? (
                        <>
                            <div className={styles.avatarWrapper}>
                                <img 
                                    src={getAvatar(playerB)} 
                                    alt="B" 
                                    className={styles.slotAvatar}
                                    onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }} 
                                />
                            </div>
                            <div className={styles.slotMeta}>
                                <span className={styles.slotName}>{playerB.fn || playerB.first_name} {playerB.ln || playerB.last_name}</span>
                                <span className={styles.slotDetails}>
                                    {playerB.pos || playerB.position} • {playerB.team || playerB.t} {getMatchupOpp(playerB.player_id || playerB.id) !== 'BYE' ? `(${getMatchupOpp(playerB.player_id || playerB.id)})` : ''}
                                </span>
                            </div>
                            <button className={styles.swapBtn} onClick={(e) => { e.stopPropagation(); setPlayerB(null); setAnalysisResult(null); }}>
                                <i className="material-icons">close</i>
                            </button>
                        </>
                    ) : (
                        <div className={styles.emptyContent}>
                            <i className="material-icons">person_add</i>
                            <span>Select Player B</span>
                        </div>
                    )}
                </div>
            </div>

            {/* SIDE-BY-SIDE STAT GRID */}
            {playerA && playerB && (
                <div className={styles.statComparison}>
                    <div className={styles.statHeaderRow}>
                        <img 
                            src={getAvatar(playerA)} 
                            alt="A" 
                            className={styles.statAvatarMini} 
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }}
                        />
                        <div className={styles.statHeaderTitle}>Wk {activeWeek} Projections</div>
                        <img 
                            src={getAvatar(playerB)} 
                            alt="B" 
                            className={styles.statAvatarMini} 
                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }}
                        />
                    </div>
                    
                    {renderStatRow('Proj FPTS', 'pts_custom')}
                    {renderStatRow('Pass Yds', 'pass_yd')}
                    {renderStatRow('Rush Yds', 'rush_yd')}
                    {renderStatRow('Receptions', 'rec')}
                    {renderStatRow('Rec Yds', 'rec_yd')}
                    {renderStatRow('Total TDs', 'any_td')}
                </div>
            )}

            <div className={styles.actionContainer}>
                <button 
                    className={`${styles.evalButton} ${isAnalyzing ? styles.analyzing : ''}`}
                    onClick={runMatchupAnalysis}
                    disabled={isAnalyzing}
                >
                    {isAnalyzing ? (
                        <>
                            <i className={`material-icons ${styles.spin}`}>autorenew</i> Compiling Report...
                        </>
                    ) : (
                        <>
                            <i className="material-icons">psychology</i> Generate Verdict
                        </>
                    )}
                </button>
            </div>

            {/* ERROR / RESULT CARD */}
            {uiErrorMessage && (
                <div className={styles.resultCard} style={{ borderLeft: '4px solid #ef4444' }}>
                    <div className={styles.resultHeader} style={{ color: '#ef4444' }}>
                        <i className="material-icons">error_outline</i> SYSTEM ERROR
                    </div>
                    <div className={styles.reasoningBox}>
                        <p>{uiErrorMessage}</p>
                    </div>
                </div>
            )}

            {analysisResult && !isAnalyzing && !uiErrorMessage && (
                <div className={styles.resultCard}>
                    <div className={styles.resultHeader}>
                        <i className="material-icons">verified</i> OFFICIAL VERDICT
                    </div>
                    
                    <div className={styles.verdictTitle}>
                        {analysisResult.verdict}
                    </div>

                    <div className={styles.confidenceBarContainer}>
                        <div className={styles.confidenceMeta}>
                            <span>Confidence Score</span>
                            <span>{analysisResult.confidence}%</span>
                        </div>
                        <div className={styles.confBarBg}>
                            <div className={styles.confBarFill} style={{ width: `${analysisResult.confidence}%` }}></div>
                        </div>
                    </div>

                    <div className={styles.reasoningBox}>
                        <p>{analysisResult.reasoning}</p>
                    </div>
                </div>
            )}

            {/* SEARCH MODAL */}
            {isSearchOpen && (
                <div className={styles.searchOverlay} onClick={() => setIsSearchOpen(null)}>
                    <div className={styles.searchModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>Select Player {isSearchOpen}</h2>
                            <button className={styles.closeModalBtn} onClick={() => setIsSearchOpen(null)}>
                                <i className="material-icons">close</i>
                            </button>
                        </div>
                        
                        <div className={styles.searchInputWrapper}>
                            <i className="material-icons">search</i>
                            <input 
                                type="text"
                                placeholder="Search active NFL player..."
                                className={styles.searchInput}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className={styles.searchResults}>
                            {searchResults.length > 0 ? (
                                searchResults.map(p => (
                                    <div key={p.player_id || p.id} className={styles.searchRow} onClick={() => handleSelectPlayer(p)}>
                                        <img 
                                            src={getAvatar(p)} 
                                            alt="" 
                                            className={styles.searchAvatar} 
                                            onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }}
                                        />
                                        <div className={styles.searchMeta}>
                                            <span className={styles.searchName}>{p.fn || p.first_name} {p.ln || p.last_name}</span>
                                            <span className={styles.searchTeam}>
                                                {p.pos || p.position} • {p.team || p.t || 'NFL'}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                searchQuery && <div className={styles.noResults}>No active NFL players found matching "{searchQuery}".</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}