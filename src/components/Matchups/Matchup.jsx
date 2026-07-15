import React, { useState, useEffect } from 'react';
import { getTeamFromTeamManagers } from '../../utils/helperFunctions/universalFunctions';
import styles from './Matchup.module.css';

export default function Matchup({ matchup, players, leagueTeamManagers, year, week, leagueData, initialExpanded = false }) {
    if (!matchup || matchup.length < 2) return null;

    const [teamA, teamB] = matchup;
    const metaA = getTeamFromTeamManagers(leagueTeamManagers, teamA.roster_id, year);
    const metaB = getTeamFromTeamManagers(leagueTeamManagers, teamB.roster_id, year);

    const [isExpanded, setIsExpanded] = useState(false);
    
    useEffect(() => {
        setIsExpanded(window.innerWidth > 1100 ? initialExpanded : false);
    }, [initialExpanded]);

    const scoreA = teamA.points?.reduce((acc, val) => acc + val, 0) || 0;
    const scoreB = teamB.points?.reduce((acc, val) => acc + val, 0) || 0;

    let projA = 0;
    let projB = 0;
    const startersA = teamA.starters || [];
    const startersB = teamB.starters || [];

    startersA.forEach(pId => { projA += parseFloat(players[pId]?.wi?.[week]?.p || 0); });
    startersB.forEach(pId => { projB += parseFloat(players[pId]?.wi?.[week]?.p || 0); });

    const projectionDifference = projA - projB;
    const varianceScaleKey = 0.045;
    const calculatedOddsA = Math.round(100 / (1 + Math.exp(-varianceScaleKey * projectionDifference)));
    const oddsA = Math.max(1, Math.min(99, calculatedOddsA));
    const oddsB = 100 - oddsA;

    const rosterPositions = leagueData?.roster_positions || [];

    const getAvatar = (playerId, playerMeta) => {
        if (!playerMeta) return 'https://sleepercdn.com/images/v2/icons/player_default.webp';
        if (playerMeta.pos === 'DEF') return `https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png`;
        return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;
    };

    const getPositionStyle = (slotName, playerA, playerB) => {
        const rawPos = playerA?.pos || playerB?.pos || slotName || 'BN';
        const cleanPos = rawPos.toUpperCase();
        const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'BN'];
        const basePos = validPositions.includes(cleanPos) ? cleanPos : 'BN';
        return { backgroundColor: `var(--${basePos})`, color: '#0b0e14', fontWeight: '800' };
    };

    return (
        <div className={`${styles.matchupCard} ${isExpanded ? styles.expanded : ''}`}>
            <div className={styles.scoreboardWrapper} onClick={() => setIsExpanded(!isExpanded)}>
                
                {/* 1. DESKTOP LAYOUT */}
                <div className={styles.desktopScoreboard}>
                    <div className={styles.teamHeader}>
                        <div className={styles.teamIdentity}>
                            <img src={metaA.avatar} alt="Team A" className={styles.teamAvatar} />
                            <div className={styles.teamNameContainer}>
                                <div className={styles.teamName}>{metaA.name}</div>
                                <div className={styles.projTotal}>Proj: {projA.toFixed(2)}</div>
                            </div>
                        </div>
                        <div className={`${styles.teamScore} ${styles.scoreGreen}`}>{scoreA.toFixed(2)}</div>
                    </div>
                    
                    <div className={styles.vsBadge}>
                        VS
                        <i className="material-icons" style={{ fontSize: '12px', display: 'block', margin: '2px auto 0' }}>
                            {isExpanded ? 'expand_less' : 'expand_more'}
                        </i>
                    </div>
                    
                    <div className={styles.teamHeader}>
                        <div className={`${styles.teamScore} ${styles.scoreRed}`}>{scoreB.toFixed(2)}</div>
                        <div className={`${styles.teamIdentity} ${styles.alignRight}`}>
                            <div className={`${styles.teamNameContainer} ${styles.alignRight}`}>
                                <div className={styles.teamName}>{metaB.name}</div>
                                <div className={styles.projTotal}>Proj: {projB.toFixed(2)}</div>
                            </div>
                            <img src={metaB.avatar} alt="Team B" className={styles.teamAvatar} />
                        </div>
                    </div>
                </div>

                {/* 2. MOBILE NATIVE APP LAYOUT (Mirroring Sleeper) */}
                <div className={styles.mobileScoreboard}>
                    <div className={styles.mHeaderRow1}>
                        <img src={metaA.avatar} className={styles.mAvatar} alt="A" />
                        
                        <div className={styles.mOddsWrapper}>
                            <div className={styles.mOddsLabel}><span className={styles.mWinPct}>{oddsA}%</span> WIN</div>
                            <div className={styles.mOddsBar}><div className={styles.mOddsFillGreen} style={{width: `${oddsA}%`}}></div></div>
                        </div>
                        
                        <div className={styles.mScoreWrapperLeft}>
                            <div className={styles.mActual}>{scoreA > 0 ? scoreA.toFixed(2) : '-'}</div>
                        </div>
                        
                        <div className={styles.mVsBadge}>
                            VS
                            <i className="material-icons">{isExpanded ? 'expand_less' : 'expand_more'}</i>
                        </div>
                        
                        <div className={styles.mScoreWrapperRight}>
                            <div className={styles.mActual}>{scoreB > 0 ? scoreB.toFixed(2) : '-'}</div>
                        </div>
                        
                        <div className={`${styles.mOddsWrapper} ${styles.mRightAlign}`}>
                            <div className={`${styles.mOddsLabel} ${styles.mRightAlign}`}><span className={styles.mWinPctRed}>{oddsB}%</span> WIN</div>
                            <div className={`${styles.mOddsBar} ${styles.mOddsBarRight}`}><div className={styles.mOddsFillRed} style={{width: `${oddsB}%`}}></div></div>
                        </div>
                        
                        <img src={metaB.avatar} className={styles.mAvatar} alt="B" />
                    </div>

                    <div className={styles.mHeaderRow2}>
                        <div className={styles.mTeamNameText}>{metaA.name}</div>
                        <div className={styles.mProjText}>Proj {projA.toFixed(2)}</div>
                        <div className={styles.mSpacerCenter}></div>
                        <div className={`${styles.mProjText} ${styles.mRightAlign}`}>Proj {projB.toFixed(2)}</div>
                        <div className={`${styles.mTeamNameText} ${styles.mRightAlign}`}>{metaB.name}</div>
                    </div>
                </div>

                {/* Desktop Odds Bar */}
                <div className={styles.oddsContainer}>
                    <div className={styles.oddsBar}>
                        <div className={styles.oddsGreen} style={{ width: `${oddsA}%` }}></div>
                        <div className={styles.oddsRed} style={{ width: `${oddsB}%` }}></div>
                    </div>
                    <div className={styles.oddsText}>
                        <span style={{ color: '#00ceb8' }}>{oddsA}%</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.85em', textTransform: 'uppercase', fontWeight: '600' }}>Win Probability</span>
                        <span style={{ color: '#ff2a6d' }}>{oddsB}%</span>
                    </div>
                </div>
            </div>

            {/* Expanded Rosters */}
            {isExpanded && (
                <div className={styles.playerBreakdown}>
                    {startersA.map((playerIdA, idx) => {
                        const playerIdB = startersB[idx];
                        const playerA = players[playerIdA];
                        const playerB = players[playerIdB];
                        
                        const slotName = rosterPositions[idx] || 'BN';
                        const pA_Score = teamA.points?.[idx] || 0;
                        const pB_Score = teamB.points?.[idx] || 0;
                        const pA_Proj = parseFloat(playerA?.wi?.[week]?.p || 0);
                        const pB_Proj = parseFloat(playerB?.wi?.[week]?.p || 0);

                        return (
                            <div key={idx} className={styles.playerRow}>
                                {/* LEFT SIDE: Team A */}
                                <div className={styles.playerSide}>
                                    {playerA ? (
                                        <>
                                            <div className={styles.pDetailsLeft}>
                                                <span className={styles.pName}>{playerA.fn} {playerA.ln}</span>
                                                <span className={styles.pMeta}>{playerA.pos} - {playerA.t}</span>
                                            </div>
                                            <div className={styles.pScoresLeft}>
                                                <span className={styles.pScore}>{pA_Score > 0 ? pA_Score.toFixed(2) : '-'}</span>
                                                <span className={styles.pProj}>Proj {pA_Proj.toFixed(2)}</span>
                                            </div>
                                        </>
                                    ) : <div className={styles.emptySlot}>Empty Roster Slot</div>}
                                </div>
                                
                                {/* CENTER: Position Badge */}
                                <div className={styles.posBadgeWrapper}>
                                    <div className={styles.posBadge} style={getPositionStyle(slotName, playerA, playerB)}>
                                        {slotName.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX')}
                                    </div>
                                </div>
                                
                                {/* RIGHT SIDE: Team B */}
                                <div className={styles.playerSide}>
                                    {playerB ? (
                                        <>
                                            <div className={styles.pScoresRight}>
                                                <span className={styles.pScore}>{pB_Score > 0 ? pB_Score.toFixed(2) : '-'}</span>
                                                <span className={styles.pProj}>Proj {pB_Proj.toFixed(2)}</span>
                                            </div>
                                            <div className={styles.pDetailsRight}>
                                                <span className={styles.pName}>{playerB.fn} {playerB.ln}</span>
                                                <span className={styles.pMeta}>{playerB.pos} - {playerB.t}</span>
                                            </div>
                                        </>
                                    ) : <div className={styles.emptySlot}>Empty Roster Slot</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}