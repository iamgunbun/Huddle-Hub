import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { loadPlayers, getLeagueData } from '../utils/helper';
import styles from './TradeGrader.module.css';

const parseGraderResponse = (rawText) => {
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
        throw new Error("JSON format error.");
    }
};

export default function TradeGrader() {
    const { activeLeague, isPremium, setShowPremiumModal } = useLeague();
    const [loading, setLoading] = useState(true);
    const [playersInfo, setPlayersInfo] = useState({});
    
    // Trade State
    const [leagueType, setLeagueType] = useState('Dynasty');
    const [sideA, setSideA] = useState([]);
    const [sideB, setSideB] = useState([]);
    
    // Modal States
    const [isSearchOpen, setIsSearchOpen] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isPickModalOpen, setIsPickModalOpen] = useState(null);
    const [pickYear, setPickYear] = useState(new Date().getFullYear());
    const [pickRound, setPickRound] = useState(1);

    // Engine States
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [gradeResult, setGradeResult] = useState(null);
    const [uiErrorMessage, setUiErrorMessage] = useState(null);

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [pData, lData] = await Promise.all([
                    loadPlayers(activeLeague.sleeper_league_id),
                    getLeagueData(activeLeague.sleeper_league_id)
                ]);
                if (isMounted) {
                    setPlayersInfo(pData?.players || pData || {});
                    
                    const detectedType = lData?.settings?.type === 2 ? 'Dynasty' : (lData?.settings?.type === 1 ? 'Keeper' : 'Redraft');
                    setLeagueType(detectedType);
                    
                    setLoading(false);
                }
            } catch (e) { 
                console.error("Failed to load grader engine:", e); 
                if (isMounted) setLoading(false); 
            }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim() || !playersInfo) return [];
        const q = searchQuery.toLowerCase().trim();
        return Object.values(playersInfo)
            .filter(p => {
                if (!p || p.active === false || p.status === 'Retired') return false;
                const fn = (p.fn || p.first_name || '').toLowerCase();
                const ln = (p.ln || p.last_name || '').toLowerCase();
                const fullName = `${fn} ${ln}`.trim();
                return fn.includes(q) || ln.includes(q) || fullName.includes(q);
            })
            .sort((a, b) => (a.search_rank || 99999) - (b.search_rank || 99999))
            .slice(0, 20);
    }, [searchQuery, playersInfo]);

    const handleAddPlayer = (player) => {
        const asset = { ...player, assetType: 'player', uniqueId: player.player_id || player.id };
        if (isSearchOpen === 'A') setSideA(prev => [...prev, asset]);
        if (isSearchOpen === 'B') setSideB(prev => [...prev, asset]);
        setIsSearchOpen(null);
        setSearchQuery('');
        setGradeResult(null);
        setUiErrorMessage(null);
    };

    const handleAddPick = () => {
        const asset = {
            assetType: 'pick',
            uniqueId: `pick-${pickYear}-${pickRound}-${Date.now()}`,
            year: pickYear,
            round: pickRound
        };
        if (isPickModalOpen === 'A') setSideA(prev => [...prev, asset]);
        if (isPickModalOpen === 'B') setSideB(prev => [...prev, asset]);
        setIsPickModalOpen(null);
        setGradeResult(null);
        setUiErrorMessage(null);
    };

    const handleRemoveAsset = (side, uniqueId) => {
        if (side === 'A') setSideA(prev => prev.filter(a => a.uniqueId !== uniqueId));
        if (side === 'B') setSideB(prev => prev.filter(a => a.uniqueId !== uniqueId));
        setGradeResult(null);
    };

    const handleClearTrade = () => {
        setSideA([]);
        setSideB([]);
        setGradeResult(null);
        setUiErrorMessage(null);
    };

    const getAvatar = (p) => {
        const pos = p.pos || p.position;
        const team = p.team || p.t || p.player_id;
        const pId = p.player_id || p.id;

        if (pos === 'DEF') return `https://sleepercdn.com/images/team_logos/nfl/${String(team).toLowerCase()}.png`;
        return `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;
    };

    const formatAssetForPrompt = (asset) => {
        if (asset.assetType === 'pick') return `- ${asset.year} Round ${asset.round} Draft Pick`;
        const name = `${asset.fn || asset.first_name} ${asset.ln || asset.last_name}`;
        const team = asset.t || asset.team || 'FA';
        const position = asset.pos || asset.position || 'Unknown';
        const status = asset.injury_status || asset.status || 'Active';
        
        // Injects the live current team and status explicitly into the list of assets
        return `- ${name} | Position: ${position} | CURRENT TEAM: ${team} | Status: ${status}`;
    };

    const runTradeEvaluation = async () => {
        // --- PAYWALL CHECK FIRES IMMEDIATELY ---
        if (!isPremium) {
            setShowPremiumModal(true);
            return;
        }

        if (sideA.length === 0 && sideB.length === 0) {
            alert("Please add assets to Side A or Side B first.");
            return;
        }

        setIsEvaluating(true);
        setGradeResult(null);
        setUiErrorMessage(null);

        const formatSideA = sideA.map(formatAssetForPrompt).join('\n');
        const formatSideB = sideB.map(formatAssetForPrompt).join('\n');

        const pipelinePrompt = `
            You are an expert NFL fantasy football analyst for a ${leagueType} format league. Evaluate this exact trade proposal.
            
            CRITICAL ROSTER OVERRIDE:
            Do not rely on historical training data for player teams, depth charts, or injury statuses. Treat the "CURRENT TEAM" and "Status" provided below as absolute, up-to-date facts for the ${new Date().getFullYear()} season. Base your evaluation strictly on this current context.

            SIDE A RECEIVES:
            ${formatSideA || '- Nothing'}

            SIDE B RECEIVES:
            ${formatSideB || '- Nothing'}

            YOUR TASK:
            1. Assess the value gained and lost by both sides based strictly on their CURRENT TEAMS provided above.
            2. Critically factor in the specific league format (${leagueType}). Draft picks hold massive weight in Dynasty, moderate in Keeper, and zero in Redraft.
            3. Assign a strict letter grade to both sides.
            4. Declare a winner or 'Even'.

            Return strictly in JSON format:
            {
                "gradeA": "Letter grade for Side A",
                "gradeB": "Letter grade for Side B",
                "winner": "State which side wins, or 'Even'",
                "analysis": "Detailed 4-5 sentence analysis explaining the grades based on the format and the players' current teams."
            }
        `;
        
        try {
            const response = await fetch('/api/evaluate-trade', {
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
            setGradeResult(parseGraderResponse(rawResponseText));
            
        } catch (error) {
            console.error("Evaluation Error:", error);
            setUiErrorMessage(error.message || "Failed to process the evaluation pipeline.");
        } finally {
            setIsEvaluating(false);
        }
    };

    if (loading) return <div className={styles.loading}>Loading Engine...</div>;

    const currentYear = new Date().getFullYear();

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Trade Grader</h1>
                <p className={styles.subtitle}>Official Trade Valuation</p>
            </div>

            <div className={styles.controlsGrid}>
                <div className={styles.controlGroup}>
                    <label>Evaluation Format</label>
                    <select className={styles.dropdown} value={leagueType} onChange={(e) => { setLeagueType(e.target.value); setGradeResult(null); }}>
                        <option value="Dynasty">Dynasty (Picks hold max value)</option>
                        <option value="Keeper">Keeper (Picks hold moderate value)</option>
                        <option value="Redraft">Redraft (Picks hold zero value)</option>
                    </select>
                </div>
            </div>

            <div className={styles.arena}>
                {/* SIDE A */}
                <div className={styles.tradeCard}>
                    <h2 className={styles.sideTitle}>Side A Receives</h2>
                    <div className={styles.assetList}>
                        {sideA.map(asset => (
                            <div key={asset.uniqueId} className={styles.assetItem}>
                                {asset.assetType === 'pick' ? (
                                    <>
                                        <div className={styles.pickIcon}>R{asset.round}</div>
                                        <div className={styles.assetMeta}>
                                            <span className={styles.assetName}>{asset.year} Draft Pick</span>
                                            <span className={styles.assetPos}>Round {asset.round}</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <img src={getAvatar(asset)} className={styles.assetImg} alt="" onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }} />
                                        <div className={styles.assetMeta}>
                                            <span className={styles.assetName}>{asset.fn || asset.first_name} {asset.ln || asset.last_name}</span>
                                            <span className={styles.assetPos}>{asset.pos || asset.position} • {asset.t || asset.team || 'FA'}</span>
                                        </div>
                                    </>
                                )}
                                <button className={styles.removeBtn} onClick={() => handleRemoveAsset('A', asset.uniqueId)}>
                                    <i className="material-icons">close</i>
                                </button>
                            </div>
                        ))}
                        
                        <div className={styles.addActions}>
                            <button className={styles.addAssetBtn} onClick={() => setIsSearchOpen('A')}>+ Add Player</button>
                            <button className={styles.addAssetBtn} onClick={() => setIsPickModalOpen('A')}>+ Add Pick</button>
                        </div>
                    </div>
                    {gradeResult && <div className={styles.gradeCircle}>{gradeResult.gradeA}</div>}
                </div>

                {/* SIDE B */}
                <div className={styles.tradeCard}>
                    <h2 className={styles.sideTitle}>Side B Receives</h2>
                    <div className={styles.assetList}>
                        {sideB.map(asset => (
                            <div key={asset.uniqueId} className={styles.assetItem}>
                                {asset.assetType === 'pick' ? (
                                    <>
                                        <div className={styles.pickIcon}>R{asset.round}</div>
                                        <div className={styles.assetMeta}>
                                            <span className={styles.assetName}>{asset.year} Draft Pick</span>
                                            <span className={styles.assetPos}>Round {asset.round}</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <img src={getAvatar(asset)} className={styles.assetImg} alt="" onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }} />
                                        <div className={styles.assetMeta}>
                                            <span className={styles.assetName}>{asset.fn || asset.first_name} {asset.ln || asset.last_name}</span>
                                            <span className={styles.assetPos}>{asset.pos || asset.position} • {asset.t || asset.team || 'FA'}</span>
                                        </div>
                                    </>
                                )}
                                <button className={styles.removeBtn} onClick={() => handleRemoveAsset('B', asset.uniqueId)}>
                                    <i className="material-icons">close</i>
                                </button>
                            </div>
                        ))}
                        
                        <div className={styles.addActions}>
                            <button className={styles.addAssetBtn} onClick={() => setIsSearchOpen('B')}>+ Add Player</button>
                            <button className={styles.addAssetBtn} onClick={() => setIsPickModalOpen('B')}>+ Add Pick</button>
                        </div>
                    </div>
                    {gradeResult && <div className={styles.gradeCircle}>{gradeResult.gradeB}</div>}
                </div>
            </div>

            <div className={styles.actionContainer}>
                <button 
                    className={`${styles.evalButton} ${isEvaluating ? styles.analyzing : ''}`} 
                    onClick={runTradeEvaluation} 
                    disabled={isEvaluating}
                >
                    {isEvaluating ? (
                        <><i className={`material-icons ${styles.spin}`}>autorenew</i> Compiling Report...</>
                    ) : (
                        <><i className="material-icons">psychology</i> Generate Grade</>
                    )}
                </button>

                {(sideA.length > 0 || sideB.length > 0 || gradeResult) && !isEvaluating && (
                    <button className={styles.clearTradeBtn} onClick={handleClearTrade}>
                        <i className="material-icons">delete_sweep</i> Clear Trade
                    </button>
                )}
            </div>

            {uiErrorMessage && (
                <div className={styles.errorBox}>
                    <div className={styles.errorHeader}>
                        <i className="material-icons">error_outline</i> SYSTEM ERROR
                    </div>
                    <p>{uiErrorMessage}</p>
                </div>
            )}

            {gradeResult && !isEvaluating && !uiErrorMessage && (
                <div className={styles.verdictCard}>
                    <h3 className={styles.verdictWinner}>Winner: {gradeResult.winner}</h3>
                    <p className={styles.verdictAnalysis}>{gradeResult.analysis}</p>
                </div>
            )}

            {/* PLAYER SEARCH MODAL */}
            {isSearchOpen && (
                <div className={styles.searchOverlay} onClick={() => setIsSearchOpen(null)}>
                    <div className={styles.searchModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>Add Player to Side {isSearchOpen}</h2>
                            <button className={styles.closeModalBtn} onClick={() => setIsSearchOpen(null)}>
                                <i className="material-icons">close</i>
                            </button>
                        </div>
                        <div className={styles.searchInputWrapper}>
                            <i className="material-icons">search</i>
                            <input type="text" placeholder="Search active NFL player..." className={styles.searchInput} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
                        </div>
                        <div className={styles.searchResults}>
                            {searchResults.length > 0 ? (
                                searchResults.map(p => (
                                    <div key={p.player_id || p.id} className={styles.searchRow} onClick={() => handleAddPlayer(p)}>
                                        <img src={getAvatar(p)} className={styles.searchAvatar} alt="" onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }} />
                                        <div className={styles.searchMeta}>
                                            <span className={styles.searchName}>{p.fn || p.first_name} {p.ln || p.last_name}</span>
                                            <span className={styles.searchTeam}>{p.pos || p.position} • {p.t || p.team || 'NFL'}</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                searchQuery && <div className={styles.noResults}>No players found matching "{searchQuery}".</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* DRAFT PICK MODAL */}
            {isPickModalOpen && (
                <div className={styles.searchOverlay} onClick={() => setIsPickModalOpen(null)}>
                    <div className={styles.pickModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>Add Pick to Side {isPickModalOpen}</h2>
                            <button className={styles.closeModalBtn} onClick={() => setIsPickModalOpen(null)}>
                                <i className="material-icons">close</i>
                            </button>
                        </div>
                        <div className={styles.pickControls}>
                            <div className={styles.controlGroup}>
                                <label>Draft Year</label>
                                <select className={styles.dropdown} value={pickYear} onChange={(e) => setPickYear(parseInt(e.target.value))}>
                                    {[0, 1, 2, 3].map(offset => (
                                        <option key={currentYear + offset} value={currentYear + offset}>{currentYear + offset}</option>
                                    ))}
                                </select>
                            </div>
                            <div className={styles.controlGroup}>
                                <label>Draft Round</label>
                                <select className={styles.dropdown} value={pickRound} onChange={(e) => setPickRound(parseInt(e.target.value))}>
                                    {[1, 2, 3, 4, 5, 6, 7].map(r => (
                                        <option key={r} value={r}>Round {r}</option>
                                    ))}
                                </select>
                            </div>
                            <button className={styles.goldBtn} onClick={handleAddPick}>Append Pick</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}