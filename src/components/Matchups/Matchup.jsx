import React, { useState, useEffect } from 'react';
import { getTeamFromTeamManagers } from '../../utils/helperFunctions/universalFunctions';
import PlayerModal from '../PlayerModal';
import styles from './Matchup.module.css';

export default function Matchup({ matchup, players, leagueTeamManagers, year, week, leagueData, initialExpanded = false }) {
    if (!matchup || matchup.length < 2) return null;

    const [teamA, teamB] = matchup;
    const metaA = getTeamFromTeamManagers(leagueTeamManagers, teamA.roster_id, year);
    const metaB = getTeamFromTeamManagers(leagueTeamManagers, teamB.roster_id, year);

    const [isExpanded, setIsExpanded] = useState(false);
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    
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

    const getPositionStyle = (slotName, playerA, playerB) => {
        const rawPos = playerA?.pos || playerB?.pos || slotName || 'BN';
        const cleanPos = rawPos.toUpperCase();
        const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'BN'];
        const basePos = validPositions.includes(cleanPos) ? cleanPos : 'BN';
        return { backgroundColor: `var(--${basePos})`, color: '#0b0e14', fontWeight: '800' };
    };

    const colorGreen = '#00ceb8';
    const colorRed = '#ff2a6d';
    const colorTied = '#94a3b8'; 

    const oddsColorA = oddsA > oddsB ? colorGreen : (oddsB > oddsA ? colorRed : colorTied);
    const oddsColorB = oddsB > oddsA ? colorGreen : (oddsA > oddsB ? colorRed : colorTied);

    const scoreColorA = scoreA > scoreB ? colorGreen : (scoreB > scoreA ? colorRed : colorTied);
    const scoreColorB = scoreB > scoreA ? colorGreen : (scoreA > scoreB ? colorRed : colorTied);

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
                        <div className={styles.teamScore} style={{ color: scoreColorA }}>
                            {scoreA > 0 ? scoreA.toFixed(2) : '-'}
                        </div>
                    </div>
                    
                    <div className={styles.vsBadge}>
                        VS
                        <i className="material-icons" style={{ fontSize: '12px', display: 'block', margin: '2px auto 0' }}>
                            {isExpanded ? 'expand_less' : 'expand_more'}
                        </i>
                    </div>
                    
                    <div className={styles.teamHeader}>
                        <div className={styles.teamScore} style={{ color: scoreColorB }}>
                            {scoreB > 0 ? scoreB.toFixed(2) : '-'}
                        </div>
                        <div className={`${styles.teamIdentity} ${styles.alignRight}`}>
                            <div className={`${styles.teamNameContainer} ${styles.alignRight}`}>
                                <div className={styles.teamName}>{metaB.name}</div>
                                <div className={styles.projTotal}>Proj: {projB.toFixed(2)}</div>
                            </div>
                            <img src={metaB.avatar} alt="Team B" className={styles.teamAvatar} />
                        </div>
                    </div>
                </div>

                {/* 2. MOBILE LAYOUT */}
                <div className={styles.mobileScoreboard}>
                    <div className={styles.mGridTop}>
                        <div className={styles.mProfileLeft}>
                            <img src={metaA.avatar} className={styles.mAvatar} alt="A" />
                            <div className={styles.mNameStack}>
                                <span className={styles.mTeamNameText}>{metaA.name}</span>
                            </div>
                        </div>
                        <div className={styles.mVsBadge}>
                            VS
                            <i className="material-icons">{isExpanded ? 'expand_less' : 'expand_more'}</i>
                        </div>
                        <div className={styles.mProfileRight}>
                            <div className={`${styles.mNameStack} ${styles.mRightAlign}`}>
                                <span className={styles.mTeamNameText}>{metaB.name}</span>
                            </div>
                            <img src={metaB.avatar} className={styles.mAvatar} alt="B" />
                        </div>
                    </div>

                    <div className={styles.mGridBottom}>
                        <div className={styles.mStatBoxLeft}>
                            <div className={styles.mOddsLabel}>
                                <span className={styles.mWinPct} style={{ color: oddsColorA }}>{oddsA}%</span> WIN
                            </div>
                            <div className={styles.mOddsBar}>
                                <div style={{ width: `${oddsA}%`, background: oddsColorA, height: '100%' }}></div>
                            </div>
                        </div>
                        <div className={styles.mScoreBoxLeft}>
                            <div className={styles.mActual} style={{ color: scoreColorA }}>
                                {scoreA > 0 ? scoreA.toFixed(2) : '-'}
                            </div>
                            <div className={styles.mProj}>Proj: {projA.toFixed(2)}</div>
                        </div>

                        <div className={styles.mSpacer}></div>

                        <div className={styles.mScoreBoxRight}>
                            <div className={styles.mActual} style={{ color: scoreColorB }}>
                                {scoreB > 0 ? scoreB.toFixed(2) : '-'}
                            </div>
                            <div className={styles.mProj}>Proj: {projB.toFixed(2)}</div>
                        </div>
                        <div className={styles.mStatBoxRight}>
                            <div className={`${styles.mOddsLabel} ${styles.mRightAlign}`}>
                                <span className={styles.mWinPctRed} style={{ color: oddsColorB }}>{oddsB}%</span> WIN
                            </div>
                            <div className={`${styles.mOddsBar} ${styles.mOddsBarRight}`}>
                                <div style={{ width: `${oddsB}%`, background: oddsColorB, height: '100%' }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.oddsContainer}>
                    <div className={styles.oddsBarBg} style={{ background: oddsColorB }}>
                        <div style={{ width: `${oddsA}%`, background: oddsColorA, height: '100%', borderRadius: '3px 0 0 3px' }}></div>
                    </div>
                    <div className={styles.oddsText}>
                        <span style={{ color: oddsColorA }}>{oddsA}%</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.85em', textTransform: 'uppercase', fontWeight: '600' }}>Win Probability</span>
                        <span style={{ color: oddsColorB }}>{oddsB}%</span>
                    </div>
                </div>
            </div>

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

                        const pScoreColorA = pA_Score > pB_Score ? colorGreen : (pB_Score > pA_Score ? colorRed : '#f8fafc');
                        const pScoreColorB = pB_Score > pA_Score ? colorGreen : (pA_Score > pB_Score ? colorRed : '#f8fafc');

                        return (
                            <div key={idx} className={styles.playerRow}>
                                <div 
                                    className={styles.playerSideLeft} 
                                    onClick={() => playerA && setSelectedPlayer(playerA)}
                                    style={{ cursor: playerA ? 'pointer' : 'default' }}
                                >
                                    {playerA ? (
                                        <>
                                            <div className={styles.pInfoLeft}>
                                                <span className={styles.pName}>{playerA.fn ? playerA.fn.charAt(0) + '.' : ''} {playerA.ln || 'Unknown'}</span>
                                                <span className={styles.pMeta}>
                                                    {playerA.pos} • {playerA.t || 'FA'} 
                                                    <span style={{ color: '#eebf1c', marginLeft: '6px', fontWeight: '800' }}>
                                                        {playerA.wi?.[week]?.opp ? `| ${playerA.wi[week].opp}` : ''}
                                                    </span>
                                                </span>
                                            </div>
                                            <div className={styles.pScoresLeft}>
                                                <span className={styles.pScore} style={{ color: pScoreColorA }}>
                                                    {pA_Score > 0 ? pA_Score.toFixed(2) : '-'}
                                                </span>
                                                <span className={styles.pProj}>Proj {pA_Proj.toFixed(2)}</span>
                                            </div>
                                        </>
                                    ) : <div className={styles.emptySlot}>Empty</div>}
                                </div>
                                
                                <div className={styles.posBadgeWrapper}>
                                    <div className={styles.posBadge} style={getPositionStyle(slotName, playerA, playerB)}>
                                        {slotName.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX')}
                                    </div>
                                </div>
                                
                                <div 
                                    className={styles.playerSideRight}
                                    onClick={() => playerB && setSelectedPlayer(playerB)}
                                    style={{ cursor: playerB ? 'pointer' : 'default' }}
                                >
                                    {playerB ? (
                                        <>
                                            <div className={styles.pScoresRight}>
                                                <span className={styles.pScore} style={{ color: pScoreColorB }}>
                                                    {pB_Score > 0 ? pB_Score.toFixed(2) : '-'}
                                                </span>
                                                <span className={styles.pProj}>Proj {pB_Proj.toFixed(2)}</span>
                                            </div>
                                            <div className={styles.pInfoRight}>
                                                <span className={styles.pName}>{playerB.fn ? playerB.fn.charAt(0) + '.' : ''} {playerB.ln || 'Unknown'}</span>
                                                <span className={styles.pMeta}>
                                                    <span style={{ color: '#eebf1c', marginRight: '6px', fontWeight: '800' }}>
                                                        {playerB.wi?.[week]?.opp ? `${playerB.wi[week].opp} |` : ''}
                                                    </span>
                                                    {playerB.t || 'FA'} • {playerB.pos} 
                                                </span>
                                            </div>
                                        </>
                                    ) : <div className={styles.emptySlot}>Empty</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            
            {/* Modal Injection */}
            {selectedPlayer && (
                <PlayerModal 
                    player={selectedPlayer} 
                    week={week} 
                    onClose={() => setSelectedPlayer(null)} 
                />
            )}
        </div>
    );
}