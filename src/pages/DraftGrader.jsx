import React, { useState, useEffect } from 'react';
import { useLeague } from '../context/LeagueContext';
import { getLeagueTeamManagers, getLeagueData, loadPlayers, getNflState } from '../utils/helper';
import { fetchYahooDraft } from '../utils/yahooService';
import { isSameLeagueChain } from '../utils/yahooHistory';
import { resolvePlayerFromMeta } from '../utils/playerPool';
import { describeExperienceAtDraft } from '../utils/draftContext';
import styles from './DraftGrader.module.css';

const isYahooLeagueId = (id) => !!id && (String(id).includes('.') || !/^\d+$/.test(String(id)));

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
    const [playersMap, setPlayersMap] = useState({});
    const [playersByName, setPlayersByName] = useState({});
    // Yahoo's own details for drafted players, keyed by Yahoo player id -- the
    // shared dictionary only covers players Sleeper's yahoo_id crosswalk
    // knows, and the gaps are what left this tool's picks reading "Unknown".
    const [yahooPlayerMeta, setYahooPlayerMeta] = useState({});
    // A Yahoo board arrives with its picks already attached (built straight
    // from draftresults), so there's nothing further to fetch per-draft.
    const [yahooDraftsMap, setYahooDraftsMap] = useState({});
    // The real current NFL season -- used to tell the AI how many seasons
    // have actually elapsed since a given draft, so it doesn't describe a
    // now-established player as still being a rookie or a late-round unknown.
    const [currentSeason, setCurrentSeason] = useState(null);

    const [isEvaluating, setIsEvaluating] = useState(false);
    const [gradeResult, setGradeResult] = useState(null);
    const [uiErrorMessage, setUiErrorMessage] = useState(null);

    // Yahoo picks carry only a player id -- no embedded name/position/team the
    // way Sleeper's draft picks do -- so a name has to be resolved the same
    // way the Draft Room page does: the shared dictionary first, then Yahoo's
    // own details bridged in by name for anything the crosswalk missed.
    const resolvePick = (pick) => {
        // The dictionary's `exp` is the player's real experience right now,
        // regardless of which resolution path names them -- looked up here so
        // every path can report it, not just the direct-dictionary one.
        const dictEntry = playersMap[pick.player_id];
        const exp = typeof dictEntry?.exp === 'number' ? dictEntry.exp
            : (typeof dictEntry?.years_exp === 'number' ? dictEntry.years_exp : null);

        if (pick.metadata) {
            return {
                fn: pick.metadata.first_name,
                ln: pick.metadata.last_name,
                pos: pick.metadata.position,
                t: pick.metadata.team || 'FA',
                exp,
            };
        }
        if (dictEntry) return { fn: dictEntry.fn, ln: dictEntry.ln, pos: dictEntry.pos, t: dictEntry.t || 'FA', exp };

        const meta = yahooPlayerMeta[pick.player_id];
        if (!meta) return { fn: 'Unknown', ln: '', pos: 'BN', t: 'FA', exp: null };

        const matched = resolvePlayerFromMeta(meta, playersMap, playersByName);
        return matched
            ? { fn: matched.fn, ln: matched.ln, pos: matched.pos, t: matched.t || meta.t || 'FA', exp: typeof matched.exp === 'number' ? matched.exp : null }
            : { fn: meta.fn, ln: meta.ln, pos: meta.pos, t: meta.t || 'FA', exp: null };
    };

    useEffect(() => {
        const loadHistory = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [tmData, pData, nflState] = await Promise.all([
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    loadPlayers(activeLeague.sleeper_league_id),
                    getNflState().catch(() => null),
                ]);
                setCurrentSeason(parseInt(nflState?.season) || null);
                setTeamManagers(tmData);
                setPlayersMap(pData?.players || {});
                setPlayersByName(pData?.playersByName || {});

                let curId = activeLeague.sleeper_league_id;
                let allDrafts = [];

                if (isYahooLeagueId(curId)) {
                    // Yahoo has no drafts-per-league listing: each season's league
                    // key holds exactly one draft, so the season chain IS the list.
                    const visited = new Set();
                    const picksByDraft = {};
                    const collectedMeta = {};
                    let successor = null;

                    while (curId && curId !== "0" && curId !== 0 && !visited.has(curId)) {
                        visited.add(curId);
                        const leagueData = await getLeagueData(curId);
                        if (!leagueData) break;

                        // Same guard the records and trophy-room walks use, so a
                        // stray renew pointer can't pull in another league's draft.
                        if (successor && !isSameLeagueChain(leagueData, successor)) break;
                        successor = leagueData;

                        const board = await fetchYahooDraft(curId, {
                            season: leagueData.season,
                            isAuction: !!leagueData.settings?.is_auction_draft,
                        });
                        if (board) {
                            picksByDraft[board.draft_id] = board.picks;
                            Object.assign(collectedMeta, board.playerMeta || {});
                            allDrafts.push(board);
                        }

                        curId = leagueData.previous_league_id;
                    }

                    setYahooPlayerMeta(collectedMeta);
                    setYahooDraftsMap(picksByDraft);
                    const sortedYahoo = allDrafts.sort((a, b) => b.season - a.season);
                    setDraftsList(sortedYahoo);
                    if (sortedYahoo.length > 0) {
                        setSelectedDraftId(sortedYahoo[0].draft_id);
                        setDraftPicks(picksByDraft[sortedYahoo[0].draft_id] || []);
                    }
                    return;
                }

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

        // A Yahoo draft's picks are already sitting in yahooDraftsMap -- built
        // from draftresults when the season chain was walked above -- so there
        // is no picks endpoint to call for it.
        if (isYahooLeagueId(activeLeague?.sleeper_league_id)) {
            setDraftPicks((yahooDraftsMap[selectedDraftId] || []).slice().sort((a, b) => a.round - b.round || a.pick_no - b.pick_no));
            setGradeResult(null);
            setUiErrorMessage(null);
            return;
        }

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
    }, [selectedDraftId, yahooDraftsMap, activeLeague]);

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
        const draftYear = parseInt(activeDraft?.season) || currentSeason;
        const yearsSinceDraft = (currentSeason && draftYear) ? Math.max(0, currentSeason - draftYear) : 0;

        const formattedPicks = teamPicks.map(p => {
            const player = resolvePick(p);
            const experienceNote = describeExperienceAtDraft(player.exp, yearsSinceDraft);
            const suffix = experienceNote ? ` [${experienceNote}]` : '';
            return `- Round ${p.round}, Pick ${p.draft_slot}: ${player.fn} ${player.ln} (${player.pos} - ${player.t})${suffix}`;
        }).join('\n');

        // Whether a player was a rookie, and whether their draft-day price still
        // reflects their real market value, are exactly the facts that go stale
        // between the model's training data and now -- a since-broken-out
        // "late-round value" doesn't get relabeled on its own, and a rookie from
        // a past draft doesn't stay described as a current rookie without being
        // told otherwise. The bracketed note on each pick above is the actual
        // answer computed from this app's own data; the rule below says to use it.
        const timelineNote = yearsSinceDraft > 0
            ? `This draft happened in the ${draftYear} season -- ${yearsSinceDraft} full NFL season${yearsSinceDraft === 1 ? ' has' : 's have'} passed since, and it is now the ${currentSeason} season.`
            : `This draft happened in the ${draftYear} season, which is the current season -- these are this year's picks.`;

        const pipelinePrompt = `
            You are an expert NFL fantasy football analyst. Evaluate this franchise's draft class for the ${draftYear} season.

            CRITICAL TIMELINE RULE: ${timelineNote} Do not rely on your own training data to guess whether a player was a rookie or where their real-world market value has moved since -- both are exactly the kind of fact that changes after a season passes. Use ONLY the "[...]" experience note given after each pick below; if a pick shows no note, its experience level is genuinely unknown and should not be guessed either.

            FRANCHISE: ${teamName}
            DRAFT PICKS:
            ${formattedPicks}

            YOUR TASK:
            1. Evaluate the overall haul based on value, upside, and tactical awareness, consistent with each pick's actual experience level as stated above.
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
                            {teamPicks.map(p => {
                                const player = resolvePick(p);
                                return (
                                    <div key={p.pick_no} className={styles.pickItem}>
                                        <div className={styles.pickBadge}>R{p.round}.{p.draft_slot.toString().padStart(2, '0')}</div>
                                        <div className={styles.pickMeta}>
                                            <span className={styles.pickName}>{player.fn} {player.ln}</span>
                                            <span className={styles.pickPos}>{player.pos} • {player.t || 'FA'}</span>
                                        </div>
                                    </div>
                                );
                            })}
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