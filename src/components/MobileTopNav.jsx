import React from 'react';
import styles from './MobileTopNav.module.css';

export default function MobileTopNav({ toggleSidebar, activeLeague }) {
    const leagueName = activeLeague?.league_name || activeLeague?.name || 'Huddle';
    
    // Safely parse the Sleeper CDN avatar URL
    const leagueAvatarUrl = activeLeague?.avatar 
        ? (activeLeague.avatar.includes('http') ? activeLeague.avatar : `https://sleepercdn.com/avatars/thumbs/${activeLeague.avatar}`) 
        : null;

    return (
        <div className={styles.mobileNavContainer}>
            <div className={styles.topBar}>
                <button className={styles.hamburgerBtn} onClick={toggleSidebar}>
                    <i className="material-icons">menu</i>
                </button>
                
                <div className={styles.leagueBranding}>
                    {leagueAvatarUrl && <img src={leagueAvatarUrl} alt="League" className={styles.leagueAvatar} />}
                    <span className={styles.leagueName}>{leagueName}</span>
                </div>
                
                <div className={styles.spacer}></div>
            </div>
        </div>
    );
}