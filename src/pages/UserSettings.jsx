import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import BackButton from '../components/BackButton';
import styles from './Settings.module.css';

export default function UserSettings() {
    const navigate = useNavigate();
    const { activeLeague } = useLeague();
    const [userId, setUserId] = useState(null);
    const [userEmail, setUserEmail] = useState('Loading...');
    
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [updatingPassword, setUpdatingPassword] = useState(false);
    const [passwordMessage, setPasswordMessage] = useState('');
    const [passwordError, setPasswordError] = useState('');

    const [newsletterOptIn, setNewsletterOptIn] = useState(true);
    const [updatingNewsletter, setUpdatingNewsletter] = useState(false);
    const [newsletterMessage, setNewsletterMessage] = useState('');

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setUserEmail(user.email);
                setUserId(user.id);

                const { data: profile } = await supabase
                    .from('profiles')
                    .select('newsletter_opt_in')
                    .eq('id', user.id)
                    .maybeSingle();

                if (profile && profile.newsletter_opt_in !== null) {
                    setNewsletterOptIn(profile.newsletter_opt_in);
                }
            }
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

    const handleToggleNewsletter = async () => {
        if (!userId || updatingNewsletter) return;
        const nextState = !newsletterOptIn;
        setUpdatingNewsletter(true);
        setNewsletterMessage('');

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ newsletter_opt_in: nextState })
                .eq('id', userId);

            if (error) throw error;

            setNewsletterOptIn(nextState);
            setNewsletterMessage(nextState ? "Subscribed to newsletter." : "Unsubscribed from newsletter.");
            setTimeout(() => setNewsletterMessage(''), 3500);
        } catch (err) {
            console.error("Error updating preferences:", err);
            alert("Failed to update notification preference.");
        } finally {
            setUpdatingNewsletter(false);
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
                
                <h2 className={styles.subHeading}>Notification Preferences</h2>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    borderRadius: '8px',
                    marginTop: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                }}>
                    <div>
                        <div style={{ fontWeight: '600', color: '#f8fafc', fontSize: '0.95em' }}>Email Newsletter & Updates</div>
                        <div style={{ fontSize: '0.8em', color: '#94a3b8', marginTop: '3px' }}>
                            Weekly fantasy alerts, pro trial updates, and news.
                        </div>
                    </div>
                    <label style={{ position: 'relative', display: 'inline-block', width: '46px', height: '24px', margin: 0 }}>
                        <input 
                            type="checkbox" 
                            checked={newsletterOptIn} 
                            onChange={handleToggleNewsletter}
                            disabled={updatingNewsletter}
                            style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                            position: 'absolute',
                            cursor: 'pointer',
                            top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: newsletterOptIn ? '#eebf1c' : '#475569',
                            borderRadius: '24px',
                            transition: '0.2s ease'
                        }}>
                            <span style={{
                                position: 'absolute',
                                height: '18px',
                                width: '18px',
                                left: newsletterOptIn ? '24px' : '3px',
                                bottom: '3px',
                                backgroundColor: '#0f172a',
                                borderRadius: '50%',
                                transition: '0.2s ease'
                            }} />
                        </span>
                    </label>
                </div>
                {newsletterMessage && <div className={styles.message} style={{ marginTop: '10px' }}>{newsletterMessage}</div>}

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