import React from 'react';
import { NavLink } from 'react-router-dom';
import styles from './MobileBottomNav.module.css';

// The five mobile shortcuts. This bar REPLACES the sidebar's top-level menu
// on narrow screens (that block is `desktopNavOnly`, hidden below 1100px),
// so whatever is not here and not under League Info has no route on a phone
// at all. Any change to the sidebar's top-level items belongs here too.
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
            <NavLink to="/rivalry" className={({ isActive }) => isActive ? `${styles.navItem} ${styles.active}` : styles.navItem}>
                <i className="material-icons">local_fire_department</i>
                <span>Rivalry</span>
            </NavLink>
            <NavLink to="/awards" className={({ isActive }) => isActive ? `${styles.navItem} ${styles.active}` : styles.navItem}>
                <i className="material-icons">emoji_events</i>
                <span>Trophy</span>
            </NavLink>
        </nav>
    );
}