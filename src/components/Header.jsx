import React from 'react';
import styles from './Header.module.css';

export default function Header({ toggleSidebar, leagueName, avatar }) {
    return (
        <header className={styles.header}>
            <button className={styles.hamburger} onClick={toggleSidebar}>
                <div className={styles.bar}></div>
                <div className={styles.bar}></div>
                <div className={styles.bar}></div>
            </button>
            
            <div className={styles.leagueTitleContainer}>
                {avatar && <img src={avatar} alt="League Logo" className={styles.leagueLogo} />}
                <div className={styles.leagueTitle}>{leagueName || 'HUDDLE'}</div>
            </div>

            {/* Empty element to perfectly counterweight the absolute center positioning */}
            <div className={styles.spacer} />
        </header>
    );
}