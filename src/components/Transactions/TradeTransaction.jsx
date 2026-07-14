import React from 'react';
import { gotoManager } from '../../utils/helper';
import { getTeamFromTeamManagers } from '../../utils/helperFunctions/universalFunctions';
import styles from './Transactions.module.css';

export default function TradeTransaction({ transaction, players, leagueTeamManagers }) {
    const getAvatar = (pos, player) => {
        if (pos === 'DEF') return { backgroundImage: `url(https://sleepercdn.com/images/team_logos/nfl/${player.toLowerCase()}.png)` };
        return { backgroundImage: `url(https://sleepercdn.com/content/nfl/players/thumb/${player}.jpg), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` };
    };

    const getNumEnd = (num) => {
        switch (num) { case 1: return "st"; case 2: return "nd"; case 3: return "rd"; default: return "th"; }
    };

    return (
        <div className={styles.tradeCard}>
            {transaction.rosters.map((owner, index) => (
                <div key={index} className={styles.managerSection}>
                    <div className={styles.managerHeader} onClick={() => gotoManager({year: transaction.season, leagueTeamManagers, rosterID: owner})}>
                        {getTeamFromTeamManagers(leagueTeamManagers, owner, transaction.season).name} Received:
                    </div>
                    <div className={styles.movesContainer}>
                        {transaction.moves.map((move, moveIndex) => {
                            const cell = move[index];
                            if (!cell || typeof cell === 'string') return null;
                            return (
                                <div key={moveIndex} className={styles.moveRow}>
                                    {cell.player ? (
                                        <>
                                            <div className={styles.avatarContainer}>
                                                <div className={styles.playerAvatar} style={getAvatar(players[cell.player].pos, cell.player)}></div>
                                                <div className={styles.badge}>+</div>
                                            </div>
                                            <div className={styles.playerInfo}>
                                                <span className={styles.playerName}>{players[cell.player].fn} {players[cell.player].ln}</span>
                                                <span className={styles.playerMeta}>{players[cell.player].pos} - {players[cell.player].t}</span>
                                            </div>
                                        </>
                                    ) : cell.pick ? (
                                        <>
                                            <div className={styles.avatarContainer}>
                                                <div className={styles.pickAvatar}>
                                                    <span style={{ fontSize: '0.6em', color: '#94a3b8' }}>Round</span>
                                                    <span style={{ fontSize: '1.1em', fontWeight: 'bold' }}>{cell.pick.round}</span>
                                                </div>
                                                <div className={styles.badge}>+</div>
                                            </div>
                                            <div className={styles.playerInfo}>
                                                <span className={styles.playerName}>{cell.pick.season} Draft Pick</span>
                                                {cell.pick.original_owner && cell.pick.original_owner !== owner && (
                                                    <span className={styles.playerMeta}>Via {getTeamFromTeamManagers(leagueTeamManagers, cell.pick.original_owner, transaction.season).name}</span>
                                                )}
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
            <div className={styles.timestamp}>{transaction.date}</div>
        </div>
    );
}