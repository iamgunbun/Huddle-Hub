import React from 'react';
import { NavLink } from 'react-router-dom';
import { tabs } from '../utils/tabs';
import styles from './MobileTopNav.module.css';

export default function MobileTopNav({ toggleSidebar }) {
    return (
        <div className={styles.mobileNavContainer}>
            {/* Hamburger icon to open your existing sidebar */}
            <button className={styles.hamburgerBtn} onClick={toggleSidebar}>
                <i className="material-icons">menu</i>
            </button>
            
            <div className={styles.scrollableTabs}>
                {tabs.map((tab) => {
                    // Skip nested league info for the top bar to keep it clean, 
                    // or link to a main hub page if preferred.
                    if (tab.nest) return null; 
                    
                    return (
                        <NavLink 
                            key={tab.key} 
                            to={tab.dest} 
                            className={({ isActive }) => isActive ? `${styles.tab} ${styles.activeTab}` : styles.tab}
                        >
                            <i className="material-icons">{tab.icon}</i>
                            <span>{tab.label}</span>
                        </NavLink>
                    );
                })}
            </div>
        </div>
    );
}