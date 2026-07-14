import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import styles from './Nav.module.css';

export default function Nav() {
    const navigate = useNavigate();
    return (
        <nav className={styles.nav}>
            <div style={{ fontWeight: 900, color: '#eebf1c', fontSize: '1.2em' }}>HUDDLE</div>
            <div className={styles.navLinks}>
                <NavLink to="/" className={({isActive}) => isActive ? styles.active : styles.navLink}>Dashboard</NavLink>
                <NavLink to="/projections" className={({isActive}) => isActive ? styles.active : styles.navLink}>Projections</NavLink>
                <NavLink to="/transactions" className={({isActive}) => isActive ? styles.active : styles.navLink}>Transactions</NavLink>
            </div>
            <button onClick={() => navigate('/login')} style={{ background: 'none', border: '1px solid #444', color: '#fff', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
        </nav>
    );
}