import React, { useState, useEffect } from 'react';
import SettingsModal from './SettingsModal.jsx';
import ChatDrawer from './ChatDrawer.jsx';
import styles from './Header.module.css';

export default function Header({ toggleSidebar, leagueName, avatar }) {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
                <button className={styles.hamburger} onClick={toggleSidebar}>
                    <div className={styles.bar}></div>
                    <div className={styles.bar}></div>
                    <div className={styles.bar}></div>
                </button>
                
                <div className={styles.leagueTitleContainer}>
                    {avatar && <img src={avatar} alt="League Logo" className={styles.leagueLogo} />}
                    <div className={styles.leagueTitle}>{leagueName || 'HUDDLE'}</div>
                </div>

                <div className={styles.headerActions} style={{ display: 'flex', gap: '8px' }}>
                    {/* Mobile Only Chat Icon */}
                    {isMobile && (
                        <button 
                            className={styles.settingsBtn} 
                            onClick={() => setIsChatOpen(true)}
                            style={{ background: 'transparent', border: 'none', color: '#eebf1c', cursor: 'pointer', padding: '10px' }}
                        >
                            <i className="material-icons" style={{ fontSize: '28px' }}>chat</i>
                        </button>
                    )}
                    
                    <button 
                        className={styles.settingsBtn} 
                        onClick={() => setIsSettingsOpen(true)}
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '10px' }}
                    >
                        <i className="material-icons" style={{ fontSize: '28px' }}>settings</i>
                    </button>
                </div>
            </header>

            {isSettingsOpen && (
                <SettingsModal onClose={() => setIsSettingsOpen(false)} />
            )}

            {/* Mobile Chat Drawer Injection */}
            {isMobile && (
                <ChatDrawer isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
            )}
        </>
    );
}