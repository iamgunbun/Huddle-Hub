import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { tabs } from '../utils/tabs';
import styles from './MobileTopNav.module.css';

export default function MobileTopNav({ toggleSidebar }) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);
    const location = useLocation();

    // Close dropdown when navigating
    useEffect(() => {
        setDropdownOpen(false);
    }, [location.pathname]);

    // Close dropdown if clicking outside of it
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className={styles.mobileNavContainer}>
            <button className={styles.hamburgerBtn} onClick={toggleSidebar}>
                <i className="material-icons">menu</i>
            </button>
            
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
                            <span>{tab.label}</span>
                        </NavLink>
                    );
                })}
            </div>
        </div>
    );
}