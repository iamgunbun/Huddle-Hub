import React from 'react';
import { NavLink } from 'react-router-dom';
import styles from './MobileBottomNav.module.css';

export default function MobileBottomNav() {
    return (
        <nav className={styles.bottomNav}>
            <NavLink to="/matchups" className={({ isActive }) => isActive ? `${styles.navItem} ${styles.active}` : styles.navItem}>
                <i className="material-icons">bolt</i>
                <span>Vs</span>
            </NavLink>
            <NavLink to="/rosters" className={({ isActive }) => isActive ? `${styles.navItem} ${styles.active}` : styles.navItem}>
                <i className="material-icons">badge</i>
                <span>My Team</span>
            </NavLink>
            <NavLink to="/" className={({ isActive }) => isActive ? `${styles.navItem} ${styles.active}` : styles.navItem} end>
                <i className="material-icons">home</i>
                <span>Home</span>
            </NavLink>
            <NavLink to="/players" className={({ isActive }) => isActive ? `${styles.navItem} ${styles.active}` : styles.navItem}>
                <i className="material-icons">groups</i>
                <span>Players</span>
            </NavLink>
            <NavLink to="/transactions" className={({ isActive }) => isActive ? `${styles.navItem} ${styles.active}` : styles.navItem}>
                <i className="material-icons">swap_horiz</i>
                <span>Trans</span>
            </NavLink>
        </nav>
    );
}