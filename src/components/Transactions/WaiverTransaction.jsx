import React from 'react';
import { gotoManager } from '../../utils/helper';
import { getTeamFromTeamManagers } from '../../utils/helperFunctions/universalFunctions';
import styles from './Transactions.module.css';

export default function WaiverTransaction({ transaction, players, leagueTeamManagers }) {
    const owner = transaction.rosters[0];
    const teamName = getTeamFromTeamManagers(leagueTeamManagers, owner, transaction.season)?.name || 'Unknown Team';
    const getAvatar = (pos, player) => {
        if (pos === 'DEF') return { backgroundImage: `url(https://sleepercdn.com/images/team_logos/nfl/${player.toLowerCase()}.png)` };
        return { backgroundImage: `url(https://sleepercdn.com/content/nfl/players/thumb/${player}.jpg), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` };
    };

    return (
        <div className={styles.waiverCard} onClick={() => gotoManager({year: transaction.season, leagueTeamManagers, rosterID: owner})}>
            <div className={styles.managerHeader}>
                <span className={styles.truncateName}>{teamName}</span>
                {transaction.moves[0][0].bid && <span style={{ color: '#94a3b8', marginLeft: '8px' }}> - ${transaction.moves[0][0].bid}</span>}
            </div>
            <div className={styles.movesContainer}>
                {transaction.moves.map((move, i) => {
                    const type = move[0].type === "Added" ? 'add' : 'drop';
                    const player = players[move[0].player];
                    return (
                        <div key={i} className={styles.moveRow}>
                            <div className={styles.avatarContainer}>
                                <div className={`${styles.playerAvatar} ${styles[type]}`} style={getAvatar(player.pos, move[0].player)}></div>
                                <div className={`${styles.badge} ${styles[type]}`}>{type === 'add' ? '+' : '-'}</div>
                            </div>
                            <div className={styles.playerInfo}>
                                <span className={styles.playerName}>{player.fn} {player.ln}</span>
                                <span className={styles.playerMeta}>{player.pos} - {player.t}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className={styles.timestamp}>{transaction.date}</div>
        </div>
    );
}