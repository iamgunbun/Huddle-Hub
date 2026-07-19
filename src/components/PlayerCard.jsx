import React, { useState, useEffect } from 'react';
import { getPlayerNews } from '../utils/helperFunctions/news'; 
import styles from './PlayerCard.module.css';

export default function PlayerCard({ playerId, playersMap, onClose }) {
    const [news, setNews] = useState([]);
    const player = playersMap[playerId];

    useEffect(() => {
        if (playerId) {
            getPlayerNews(playerId).then(setNews);
        }
    }, [playerId]);

    if (!player) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.card} onClick={e => e.stopPropagation()}>
                <button className={styles.closeBtn} onClick={onClose}>
                    <i className="material-icons">close</i>
                </button>
                
                <div className={styles.header}>
                    <img src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`} alt="Player" className={styles.avatar} />
                    <div>
                        <h2>{player.fn} {player.ln}</h2>
                        <span className={styles.tag}>{player.pos} — {player.t || 'FA'}</span>
                    </div>
                </div>

                <div className={styles.body}>
                    <h4 className={styles.sectionHeader}>Fantasy News</h4>
                    {news.length > 0 ? news.slice(0, 3).map((n, i) => (
                        <div key={i} className={styles.newsItem}>
                            <strong>{n.title}</strong>
                            <p>{n.short_description || n.description}</p>
                        </div>
                    )) : <p>No recent news found.</p>}
                </div>
            </div>
        </div>
    );
}