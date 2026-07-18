import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import styles from './UserSettings.module.css';

export default function UserSettings() {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [email, setEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setEmail(session.user.email);
            }
        };
        fetchUser();
    }, []);

    const handleUpdate = async () => {
        setLoading(true);
        setMessage(null);

        try {
            const updates = {};
            if (email) updates.email = email;
            if (newPassword) {
                if (newPassword !== confirmPassword) {
                    throw new Error("New passwords do not match.");
                }
                updates.password = newPassword;
            }

            const { error } = await supabase.auth.updateUser(updates);
            
            if (error) throw error;
            
            setMessage({ type: 'success', text: 'Account updated successfully.' });
            setNewPassword('');
            setConfirmPassword('');
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setLoading(false);
            setTimeout(() => setMessage(null), 4000);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <i className="material-icons" style={{ fontSize: '48px', color: '#eebf1c', marginBottom: '15px' }}>manage_accounts</i>
                <h1 className={styles.title}>Account Settings</h1>
            </div>

            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    Security Details
                </div>
                <div className={styles.cardBody}>
                    {message && (
                        <div className={`${styles.message} ${message.type === 'success' ? styles.success : styles.error}`}>
                            {message.text}
                        </div>
                    )}
                    
                    <div className={styles.inputGroup}>
                        <label>Email Address</label>
                        <input 
                            type="email" 
                            className={styles.inputField} 
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    
                    <div className={styles.inputGroup}>
                        <label>New Password <span className={styles.optional}>(Leave blank to keep current)</span></label>
                        <input 
                            type="password" 
                            className={styles.inputField} 
                            placeholder="Enter new password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                        />
                    </div>

                    <div className={styles.inputGroup}>
                        <label>Confirm New Password</label>
                        <input 
                            type="password" 
                            className={styles.inputField} 
                            placeholder="Retype new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                    </div>

                    <button 
                        className={styles.saveBtn} 
                        onClick={handleUpdate}
                        disabled={loading}
                    >
                        {loading ? 'Updating...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
}