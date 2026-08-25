import React from 'react';
import styles from './Messages.module.css';

export default function Messages() {
    return (
        <div className={styles.pageContainer}>
            <div className={styles.header}>
                <i className="material-icons" style={{ fontSize: '32px', color: '#eebf1c' }}>forum</i>
                <div>
                    <h1 className={styles.title}>League Chat</h1>
                    <p className={styles.subtitle}>Coordinate trades and talk trash.</p>
                </div>
            </div>

            <div className={styles.chatContainer}>
                <div className={styles.emptyState}>
                    <i className="material-icons" style={{ fontSize: '64px', color: '#eebf1c', marginBottom: '10px' }}>construction</i>
                    <h3>Under Construction</h3>
                    <p>We are currently building out the ultimate real-time league chat.</p>
                    <p style={{ marginTop: '5px', fontSize: '0.85em', color: '#64748b', fontWeight: '600' }}>Check back later this season!</p>
                </div>
            </div>
        </div>
    );
}