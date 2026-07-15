import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { tabs } from '../utils/tabs';
import styles from './MobileTopNav.module.css';

export default function MobileTopNav({ toggleSidebar, activeLeague }) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);
    const location = useLocation();

    useEffect(() => {
        setDropdownOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
            
            <div className={styles.navGrid}>
                {tabs.filter(tab => tab.key !== 'resources').map((tab) => {
                    if (tab.nest) {
                        return (
                            <div key={tab.key} className={styles.dropdownContainer} ref={dropdownRef}>
                                <button 
                                    className={`${styles.navItem} ${dropdownOpen ? styles.active : ''}`}
                                    onClick={() => setDropdownOpen(!dropdownOpen)}
                                >
                                    <i className="material-icons">{tab.icon}</i>
                                    <span>{tab.label}</span>
                                </button>
                                
                                {dropdownOpen && (
                                    <div className={styles.dropdownMenu}>
                                        {tab.children.map(child => (
                                            <NavLink 
                                                key={child.label} 
                                                to={child.dest}
                                                className={({ isActive }) => isActive ? `${styles.dropdownItem} ${styles.activeDropdown}` : styles.dropdownItem}
                                            >
                                                <i className="material-icons">{child.icon}</i>
                                                {child.label}
                                            </NavLink>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    }
                    
                    return (
                        <NavLink 
                            key={tab.key} 
                            to={tab.dest} 
                            className={({ isActive }) => isActive ? `${styles.navItem} ${styles.active}` : styles.navItem}
                        >
                            <i className="material-icons">{tab.icon}</i>
                            <span>{tab.label === 'Trades & Waivers' ? 'Transactions' : tab.label}</span>
                        </NavLink>
                    );
                })}
            </div>
        </div>
    );
}