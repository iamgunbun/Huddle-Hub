import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import BackButton from '../components/BackButton';
import styles from './Settings.module.css';

export default function UserSettings() {
    const navigate = useNavigate();
    const { activeLeague } = useLeague();
    const [userEmail, setUserEmail] = useState('Loading...');
    
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [updatingPassword, setUpdatingPassword] = useState(false);
    const [passwordMessage, setPasswordMessage] = useState('');
    const [passwordError, setPasswordError] = useState('');

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setUserEmail(user.email);
        };
        fetchUser();
    }, []);

    const handleUpdatePassword = async () => {
        if (!newPassword || newPassword !== confirmNewPassword) {
            setPasswordError("Passwords do not match.");
            setPasswordMessage('');
            return;
        }
        
        setUpdatingPassword(true);
        setPasswordError('');
        setPasswordMessage('');
        
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;
            
            setPasswordMessage("Password updated successfully.");
            setNewPassword('');
            setConfirmNewPassword('');
            setTimeout(() => setPasswordMessage(''), 4000);
        } catch (err) {
            setPasswordError(err.message || "Failed to update password.");
        } finally {
            setUpdatingPassword(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    return (
        <div className={styles.container}>
            <BackButton />
            <div className={styles.settingsCard}>
                <div className={styles.header}>
                    <i className="material-icons">manage_accounts</i>
                    <h1 className={styles.title}>User Account</h1>
                </div>
                
                <div className={styles.infoGroup}>
                    <label>Email Address</label>
                    <div className={styles.value}>{userEmail}</div>
                </div>
                
                <div className={styles.infoGroup}>
                    <label>Active League</label>
                    <div className={styles.value}>{activeLeague?.league_name || 'None Selected'}</div>
                </div>

                <div className={styles.divider}></div>
                
                <h2 className={styles.subHeading}>Change Password</h2>
                <div className={styles.infoGroup} style={{ marginTop: '15px' }}>
                    <label>New Password</label>
                    <input 
                        type="password" 
                        className={styles.inputField} 
                        placeholder="Enter new password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                </div>
                <div className={styles.infoGroup}>
                    <label>Confirm New Password</label>
                    <input 
                        type="password" 
                        className={styles.inputField} 
                        placeholder="Re-type new password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                    />
                </div>

                {passwordError && <div className={styles.errorMessage}>{passwordError}</div>}
                {passwordMessage && <div className={styles.message}>{passwordMessage}</div>}

                <button 
                    className={styles.saveBtn} 
                    style={{ marginBottom: '30px' }} 
                    onClick={handleUpdatePassword} 
                    disabled={updatingPassword || !newPassword}
                >
                    {updatingPassword ? 'Updating...' : 'Update Password'}
                </button>

                <div className={styles.divider}></div>

                <button className={styles.logoutBtn} onClick={handleLogout}>
                    <i className="material-icons">logout</i>
                    Log Out
                </button>
            </div>
        </div>
    );
}