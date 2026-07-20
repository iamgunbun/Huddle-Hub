import React from 'react';
import styles from './Messages.module.css';

export default function Messages() {
    return (
        <div className={styles.messagesContainer}>
            <div className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <h2>Messages</h2>
                </div>
                <div className={styles.chatList}>
                    <div className={styles.chatCard}>
                        <div className={styles.avatarPlaceholder}>
                            <i className="material-icons">groups</i>
                        </div>
                        <div className={styles.chatDetails}>
                            <h4 className={styles.chatTitle}>Global League Chat</h4>
                            <p className={styles.chatPreview}>Click here to open league banter...</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <div className={styles.chatWindow}>
                <div className={styles.emptyState}>
                    <i className="material-icons" style={{ fontSize: '48px', color: '#334155', marginBottom: '15px' }}>chat</i>
                    <h2>Select a conversation</h2>
                    <p>Choose a DM or the League Chat to start messaging.</p>
                </div>
            </div>
        </div>
    );
}