import React, { useState, useEffect } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers } from '../utils/helper';
import styles from './DraftGrader.module.css';

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

export default function DraftGrader() {
    const { activeLeague, isPremium, setShowPremiumModal } = useLeague();
    const [loading, setLoading] = useState(true);
    const [draftsList, setDraftsList] = useState([]);
    const [teamManagers, setTeamManagers] = useState(null);
    
    const [selectedDraftId, setSelectedDraftId] = useState('');
    const [selectedRosterId, setSelectedRosterId] = useState('');
    const [draftPicks, setDraftPicks] = useState([]);

    const [isEvaluating, setIsEvaluating] = useState(false);
    const [gradeResult, setGradeResult] = useState(null);
    const [uiErrorMessage, setUiErrorMessage] = useState(null);

    useEffect(() => {
        const loadHistory = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const tmData = await getLeagueTeamManagers(activeLeague.sleeper_league_id);
                setTeamManagers(tmData);
                
                let curId = activeLeague.sleeper_league_id;
                let allDrafts = [];
                while (curId && curId !== "0" && curId !== 0) {
                    const res = await fetch(`https://api.sleeper.app/v1/league/${curId}/drafts`);
                    if (res.ok) {
                        const drafts = await res.json();
                        allDrafts.push(...drafts);
                    }
                    const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${curId}`);
                    if (leagueRes.ok) {
                        const leagueData = await leagueRes.json();
                        curId = leagueData.previous_league_id;
                    } else {
                        break;
                    }
                }
                const sorted = allDrafts.sort((a,b) => b.season - a.season);
                setDraftsList(sorted);
                if (sorted.length > 0) setSelectedDraftId(sorted[0].draft_id);
            } catch (e) { 
                console.error("Failed to load draft histories:", e); 
            } finally { 
                setLoading(false); 
            }
        };
        loadHistory();
    }, [activeLeague]);

    useEffect(() => {
        if (!selectedDraftId) return;
        const fetchPicks = async () => {
            try {
                const res = await fetch(`https://api.sleeper.app/v1/draft/${selectedDraftId}/picks`);
                if (res.ok) {
                    const picks = await res.json();
                    setDraftPicks(picks.sort((a, b) => a.round - b.round || a.pick_no - b.pick_no));
                }
            } catch (e) {
                console.error("Failed to fetch picks", e);
            }
        };
        fetchPicks();
        setGradeResult(null);
        setUiErrorMessage(null);
    }, [selectedDraftId]);

    const activeDraft = draftsList.find(d => d.draft_id === selectedDraftId);
    const teamPicks = draftPicks.filter(p => p.roster_id === parseInt(selectedRosterId));
    
    const yearRosters = activeDraft ? (teamManagers?.teamManagersMap[activeDraft.season] || teamManagers?.teamManagersMap[teamManagers.currentSeason] || {}) : {};
    const teamsArray = Object.entries(yearRosters).map(([rId, rData]) => ({ id: rId, name: rData.team?.name || `Team ${rId}` }));

    const runDraftEvaluation = async () => {
        // --- PAYWALL CHECK FIRES IMMEDIATELY ---
        if (!isPremium) {
            setShowPremiumModal(true);
            return;
        }

        if (!selectedRosterId || teamPicks.length === 0) {
            alert("Please select a team with drafted picks first.");
            return;
        }

        setIsEvaluating(true);
        setGradeResult(null);
        setUiErrorMessage(null);

        const teamName = teamsArray.find(t => t.id === selectedRosterId)?.name || 'Unknown Team';
        const formattedPicks = teamPicks.map(p => `- Round ${p.round}, Pick ${p.draft_slot}: ${p.metadata.first_name} ${p.metadata.last_name} (${p.metadata.position} - ${p.metadata.team})`).join('\n');

        const pipelinePrompt = `
            You are an expert NFL fantasy football analyst. Evaluate this franchise's draft class for the ${activeDraft?.season} season.
            
            FRANCHISE: ${teamName}
            DRAFT PICKS:
            ${formattedPicks}

            YOUR TASK:
            1. Evaluate the overall haul based on value, upside, and tactical awareness.
            2. Assign an overall letter grade (A+, A, A-, B+, etc.).
            3. Provide a short 3-5 word summary headline.

            Return strictly in JSON format:
            {
                "grade": "Letter grade",
                "summary": "Short headline",
                "analysis": "4-5 sentences evaluating the core picks."
            }
        `;
        
        try {
            const response = await fetch('/api/evaluate-draft', {
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

    if (loading) return <div className={styles.loading}>Loading Draft Histories...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Draft Grader</h1>
                <p className={styles.subtitle}>Scouting Class Report</p>
            </div>

            <div className={styles.controlsGrid}>
                <div className={styles.controlGroup}>
                    <label>Select Draft Year</label>
                    <select className={styles.dropdown} value={selectedDraftId} onChange={(e) => setSelectedDraftId(e.target.value)}>
                        {draftsList.map(d => (
                            <option key={d.draft_id} value={d.draft_id}>{d.season} {d.metadata?.name || 'Main Draft'}</option>
                        ))}
                    </select>
                </div>
                <div className={styles.controlGroup}>
                    <label>Select Franchise</label>
                    <select className={styles.dropdown} value={selectedRosterId} onChange={(e) => { setSelectedRosterId(e.target.value); setGradeResult(null); setUiErrorMessage(null); }}>
                        <option value="" disabled>-- Choose a Team --</option>
                        {teamsArray.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {selectedRosterId && (
                <div className={styles.draftCard}>
                    <h2 className={styles.cardTitle}>Drafted Assets</h2>
                    {teamPicks.length > 0 ? (
                        <div className={styles.picksList}>
                            {teamPicks.map(p => (
                                <div key={p.pick_no} className={styles.pickItem}>
                                    <div className={styles.pickBadge}>R{p.round}.{p.draft_slot.toString().padStart(2, '0')}</div>
                                    <div className={styles.pickMeta}>
                                        <span className={styles.pickName}>{p.metadata.first_name} {p.metadata.last_name}</span>
                                        <span className={styles.pickPos}>{p.metadata.position} • {p.metadata.team || 'FA'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.emptyPicks}>No picks found for this team in the selected draft.</div>
                    )}
                </div>
            )}

            <div className={styles.actionContainer}>
                <button 
                    className={`${styles.evalButton} ${isEvaluating ? styles.analyzing : ''}`} 
                    onClick={runDraftEvaluation} 
                    disabled={isEvaluating}
                >
                    {isEvaluating ? (
                        <><i className={`material-icons ${styles.spin}`}>autorenew</i> Generating Report...</>
                    ) : (
                        <><i className="material-icons">psychology</i> Generate Grade</>
                    )}
                </button>
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
                    <div className={styles.verdictHeader}>
                        <div className={styles.gradeCircle}>{gradeResult.grade}</div>
                        <h3 className={styles.verdictSummary}>"{gradeResult.summary}"</h3>
                    </div>
                    <p className={styles.verdictAnalysis}>{gradeResult.analysis}</p>
                </div>
            )}
        </div>
    );
}