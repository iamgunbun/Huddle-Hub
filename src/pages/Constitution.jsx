import React from 'react';
import { useLeague } from '../context/LeagueContext';
import styles from './Constitution.module.css';

export default function Constitution() {
    const { activeLeague, loading } = useLeague();

    if (loading) return <div className={styles.loading}>Loading Constitution...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <i className="material-icons" style={{ fontSize: '48px', color: '#eebf1c', marginBottom: '15px' }}>history_edu</i>
                <h1 className={styles.title}>League Constitution</h1>
                <h2 className={styles.subtitle}>{activeLeague?.league_name}</h2>
            </div>

            <div className={styles.documentCard}>
                {activeLeague?.constitution ? (
                    <div className={styles.documentText}>
                        {activeLeague.constitution}
                    </div>
                ) : (
                    <div className={styles.emptyState}>
                        <i className="material-icons">gavel</i>
                        <p>The league constitution has not been published yet.</p>
                        <p className={styles.subEmpty}>Check back later or contact your commissioner.</p>
                    </div>
                )}
            </div>
        </div>
    );
}