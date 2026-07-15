import React, { useState } from 'react';
import Matchup from './Matchup';
import { getTeamFromTeamManagers } from '../../utils/helperFunctions/universalFunctions';
import styles from './MatchupsAndBrackets.module.css';

export default function MatchupsAndBrackets({ matchupsData, leagueTeamManagers, bracketsData, playersInfo, leagueData }) {
    const [subView, setSubView] = useState('schedule');
    const [selectedWeek, setSelectedWeek] = useState(matchupsData.week);

    const handleWeekChange = (e) => setSelectedWeek(parseInt(e.target.value));
    const currentWeekData = matchupsData.matchupWeeks?.find(w => w.week === selectedWeek);
    const matchesArray = currentWeekData ? Object.values(currentWeekData.matchups) : [];

    const getPlayoffScore = (teamPoints) => {
        if (!teamPoints) return "0.00";
        let total = 0;
        let hasPoints = false;
        Object.values(teamPoints).forEach(arr => {
            if (Array.isArray(arr)) {
                hasPoints = true;
                total += arr.reduce((sum, p) => sum + (parseFloat(p) || 0), 0);
            }
        });
        return hasPoints ? `${total.toFixed(2)}` : "0.00";
    };

    const BracketViewer = ({ bracketTree, isToiletBowl }) => {
        if (!bracketTree || !bracketTree.bracket || bracketTree.bracket.length === 0) {
            return <div className={styles.emptyState}>No playoff bracket data available for this league.</div>;
        }

        const totalRounds = bracketTree.bracket.length;

        return (
            <div className={styles.bracketContainer}>
                {/* Main Championship Playoff Tree */}
                <div className={styles.bracketTreeWrapper}>
                    {bracketTree.bracket.map((roundMatches, roundIdx) => {
                        const isFinalsRound = roundIdx === totalRounds - 1;

                        // Dynamically build tracking tracks for Round 1 to insert missing BYE placements
                        let displayItems = [];
                        
                        if (roundIdx === 0 && totalRounds > 1) {
                            const round2Matches = bracketTree.bracket[1] || [];
                            const processedMatchIds = new Set();
                            
                            round2Matches.forEach((r2Match) => {
                                const teams = [r2Match[0] || {}, r2Match[1] || {}];
                                teams.forEach(t => {
                                    if (t.roster_id && !t.tFrom && !t.from && !t.m) { 
                                        displayItems.push({ isByeBlock: true, team: t });
                                    } else if (t.tFrom || t.from) {
                                        const matchId = t.tFrom || t.from;
                                        const r1Match = roundMatches.find(m => m.m === matchId || m.match_id === matchId || m.id === matchId || (m[0] && (m[0].m === matchId || m[0].match_id === matchId)));
                                        if (r1Match && !processedMatchIds.has(r1Match)) {
                                            displayItems.push({ isByeBlock: false, match: r1Match });
                                            processedMatchIds.add(r1Match);
                                        }
                                    }
                                });
                            });

                            // Fallback interleaving if dynamic pairing fails for standard 6-team formats
                            if (displayItems.length < roundMatches.length + 2) {
                                const byes = [];
                                round2Matches.forEach(m2 => {
                                    [m2[0] || {}, m2[1] || {}].forEach(t => {
                                        if (t.roster_id && !t.tFrom && !t.from) byes.push(t);
                                    });
                                });
                                
                                if (byes.length === 2 && roundMatches.length === 2) {
                                    displayItems = [
                                        { isByeBlock: true, team: byes[0] },
                                        { isByeBlock: false, match: roundMatches[0] },
                                        { isByeBlock: true, team: byes[1] },
                                        { isByeBlock: false, match: roundMatches[1] }
                                    ];
                                } else {
                                    roundMatches.forEach(m => {
                                        if (!processedMatchIds.has(m)) {
                                            displayItems.push({ isByeBlock: false, match: m });
                                            processedMatchIds.add(m);
                                        }
                                    });
                                }
                            }
                        } else {
                            roundMatches.forEach(m => displayItems.push({ isByeBlock: false, match: m }));
                        }

                        return (
                            <div key={`round-${roundIdx}`} className={styles.bracketColumn}>
                                <div className={styles.roundHeader}>
                                    ROUND {roundIdx + 1}
                                    <div className={styles.roundWeekSub}>
                                        (Week {(bracketsData?.playoffsStart || 15) + roundIdx})
                                    </div>
                                </div>
                                
                                <div className={`${styles.roundColumnLayout} ${styles[`roundIdx${roundIdx}`]}`}>
                                    <div className={styles.mainMatchesSection}>
                                        {displayItems.map((item, itemIdx) => {
                                            if (item.isByeBlock) {
                                                const meta = item.team.roster_id ? getTeamFromTeamManagers(leagueTeamManagers, item.team.roster_id, matchupsData.year) : null;
                                                return (
                                                    <div key={`bye-${itemIdx}`} className={styles.matchCard}>
                                                        <div className={styles.matchLabel}>First Round Bye</div>
                                                        <div className={`${styles.teamRow} ${styles.byeRow}`}>
                                                            <div className={styles.teamInfo}>
                                                                {meta ? <img src={meta.avatar} className={styles.avatar} alt="bye" /> : <div className={styles.avatarPlaceholder} />}
                                                                <span className={styles.teamName}>{meta ? meta.name : "TBD"}</span>
                                                            </div>
                                                            <span className={styles.score} style={{color: '#64748b', fontWeight: '800'}}>BYE</span>
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            const match = item.match;
                                            if (!match) return null;

                                            const t1 = match[0] || {};
                                            const t2 = match[1] || {};
                                            const meta1 = t1.roster_id ? getTeamFromTeamManagers(leagueTeamManagers, t1.roster_id, matchupsData.year) : null;
                                            const meta2 = t2.roster_id ? getTeamFromTeamManagers(leagueTeamManagers, t2.roster_id, matchupsData.year) : null;

                                            let label = null;
                                            if (isFinalsRound && itemIdx === 0) {
                                                label = isToiletBowl ? '💩 King (Last Place)' : '🏆 Championship';
                                            }

                                            return (
                                                <div key={`match-${roundIdx}-${itemIdx}`} className={styles.matchCard}>
                                                    {label && <div className={styles.matchLabel}>{label}</div>}
                                                    
                                                    <div className={`${styles.teamRow} ${t1.w ? styles.winnerRow : ''}`}>
                                                        <div className={styles.teamInfo}>
                                                            {meta1 ? <img src={meta1.avatar} className={styles.avatar} alt="t1" /> : <div className={styles.avatarPlaceholder} />}
                                                            <span className={styles.teamName}>{meta1 ? meta1.name : "TBD"}</span>
                                                        </div>
                                                        <span className={styles.score}>{t1.roster_id ? getPlayoffScore(t1.points) : "-"}</span>
                                                    </div>

                                                    <div className={`${styles.teamRow} ${t2.w ? styles.winnerRow : ''}`}>
                                                        <div className={styles.teamInfo}>
                                                            {meta2 ? <img src={meta2.avatar} className={styles.avatar} alt="t2" /> : <div className={styles.avatarPlaceholder} />}
                                                            <span className={styles.teamName}>{meta2 ? meta2.name : "TBD"}</span>
                                                        </div>
                                                        <span className={styles.score}>{t2.roster_id ? getPlayoffScore(t2.points) : "-"}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Consolation Section - Completely isolated at bottom of viewport */}
                <div className={styles.consolationSection}>
                    <h3 className={styles.consolationHeading}>Placement & Consolation Matches</h3>
                    <div className={styles.consolationGrid}>
                        {bracketTree.bracket.map((roundMatches, roundIdx) => {
                            const consolationMatches = [];
                            if (bracketTree.consolations) {
                                bracketTree.consolations.forEach(cons => {
                                    if (cons[roundIdx] && cons[roundIdx].length > 0) {
                                        cons[roundIdx].forEach(cMatch => {
                                            let pVal = cMatch.p || cMatch[0]?.p || cMatch[1]?.p;
                                            consolationMatches.push({ cMatch, pVal });
                                        });
                                    }
                                });
                            }

                            if (consolationMatches.length === 0) return null;

                            return (
                                <div key={`cons-round-${roundIdx}`} className={styles.consRoundColumn}>
                                    <div className={styles.consRoundTitle}>Week {(bracketsData?.playoffsStart || 15) + roundIdx}</div>
                                    <div className={styles.consCardStack}>
                                        {consolationMatches.map(({ cMatch, pVal }, cIdx) => {
                                            const ct1 = cMatch[0] || {};
                                            const ct2 = cMatch[1] || {};
                                            const cmeta1 = ct1.roster_id ? getTeamFromTeamManagers(leagueTeamManagers, ct1.roster_id, matchupsData.year) : null;
                                            const cmeta2 = ct2.roster_id ? getTeamFromTeamManagers(leagueTeamManagers, ct2.roster_id, matchupsData.year) : null;

                                            let clabel = "Consolation Match";
                                            if (pVal) {
                                                if (pVal === 3 && !isToiletBowl) clabel = "🥉 3rd Place Match";
                                                else clabel = `${pVal}th Place Match`;
                                            } else {
                                                // Hardcoded Fallback logic based on specific rounds
                                                if (!isToiletBowl) {
                                                    if (roundIdx === totalRounds - 1) clabel = "🥉 3rd Place Match";
                                                    else if (roundIdx === totalRounds - 2) clabel = "5th Place Match";
                                                    else if (roundIdx === totalRounds - 3) clabel = "7th Place Match";
                                                } else {
                                                    if (roundIdx === totalRounds - 1) clabel = "8th Place Match";
                                                    else if (roundIdx === totalRounds - 2) clabel = "9th Place Match";
                                                }
                                            }

                                            return (
                                                <div key={`cons-card-${cIdx}`} className={styles.matchCard}>
                                                    <div className={styles.matchLabel}>{clabel}</div>
                                                    <div className={styles.teamRow}>
                                                        <div className={styles.teamInfo}>
                                                            {cmeta1 ? <img src={cmeta1.avatar} className={styles.avatar} alt="ct1" /> : <div className={styles.avatarPlaceholder} />}
                                                            <span className={styles.teamName}>{cmeta1 ? cmeta1.name : "TBD"}</span>
                                                        </div>
                                                        <span className={styles.score}>{ct1.roster_id ? getPlayoffScore(ct1.points) : "-"}</span>
                                                    </div>
                                                    <div className={styles.teamRow}>
                                                        <div className={styles.teamInfo}>
                                                            {cmeta2 ? <img src={cmeta2.avatar} className={styles.avatar} alt="ct2" /> : <div className={styles.avatarPlaceholder} />}
                                                            <span className={styles.teamName}>{cmeta2 ? cmeta2.name : "TBD"}</span>
                                                        </div>
                                                        <span className={styles.score}>{ct2.roster_id ? getPlayoffScore(ct2.points) : "-"}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className={styles.container}>
            <div className={styles.subNavigation}>
                <button className={`${styles.subToggleBtn} ${subView === 'schedule' ? styles.activeSub : ''}`} onClick={() => setSubView('schedule')}>Weekly Schedule</button>
                <button className={`${styles.subToggleBtn} ${subView === 'winners' ? styles.activeSub : ''}`} onClick={() => setSubView('winners')}>Championship Bracket</button>
                <button className={`${styles.subToggleBtn} ${subView === 'losers' ? styles.activeSub : ''}`} onClick={() => setSubView('losers')}>Toilet Bowl</button>
            </div>

            {subView === 'schedule' && (
                <>
                    <div className={styles.headerControls}>
                        <h2 className={styles.title}>League Schedule</h2>
                        <select className={styles.weekSelect} value={selectedWeek} onChange={handleWeekChange}>
                            {matchupsData.matchupWeeks.map(w => <option key={w.week} value={w.week}>Week {w.week}</option>)}
                        </select>
                    </div>
                    <div className={styles.scheduleGrid}>
                        {matchesArray.map((m, i) => <Matchup key={i} matchup={m} players={playersInfo.players} leagueTeamManagers={leagueTeamManagers} year={matchupsData.year} week={selectedWeek} leagueData={leagueData} initialExpanded={false} />)}
                    </div>
                </>
            )}
            
            {subView === 'winners' && <BracketViewer bracketTree={bracketsData?.champs} isToiletBowl={false} />}
            {subView === 'losers' && <BracketViewer bracketTree={bracketsData?.losers} isToiletBowl={true} />}
        </div>
    );
}