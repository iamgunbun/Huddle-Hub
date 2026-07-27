import React, { useState, useEffect } from 'react';
import ChatDrawer from './ChatDrawer.jsx';
import styles from './Header.module.css';

export default function Header({ toggleSidebar, leagueName, avatar }) {
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1100);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 1100);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <>
            <header className={styles.header}>
                {/* PINNED LEFT: Hamburger Menu */}
                <div className={styles.pinnedLeft}>
                    <button className={styles.hamburger} onClick={toggleSidebar}>
                        <div className={styles.bar}></div>
                        <div className={styles.bar}></div>
                        <div className={styles.bar}></div>
                    </button>
                </div>
                
                {/* CENTER: League Title & Logo */}
                <div className={styles.centerContainer}>
                    {avatar && <img src={avatar} alt="League Logo" className={styles.leagueLogo} />}
                    <div className={styles.leagueTitle}>{leagueName || 'HUDDLE'}</div>
                </div>

                {/* PINNED RIGHT: Action Icons */}
                <div className={styles.pinnedRight}>
                    {isMobile && (
                        <button 
                            className={styles.chatBtn} 
                            onClick={() => setIsChatOpen(true)}
                        >
                            <i className="material-icons">chat</i>
                        </button>
                    )}
                </div>
            </header>

            {isMobile && (
                <ChatDrawer isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
            )}
        </>
    );
}