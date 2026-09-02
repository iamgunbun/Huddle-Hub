import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import styles from './Login.module.css';

export default function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLogin, setIsLogin] = useState(true);
    const [authError, setAuthError] = useState('');
    const [loading, setLoading] = useState(false);
    const [favoriteTeam, setFavoriteTeam] = useState('');
    const [newsletterOptIn, setNewsletterOptIn] = useState(true);
    
    const nflTeams = [
        { id: 'ari', name: 'Arizona Cardinals' }, { id: 'atl', name: 'Atlanta Falcons' },
        { id: 'bal', name: 'Baltimore Ravens' }, { id: 'buf', name: 'Buffalo Bills' },
        { id: 'car', name: 'Carolina Panthers' }, { id: 'chi', name: 'Chicago Bears' },
        { id: 'cin', name: 'Cincinnati Bengals' }, { id: 'cle', name: 'Cleveland Browns' },
        { id: 'dal', name: 'Dallas Cowboys' }, { id: 'den', name: 'Denver Broncos' },
        { id: 'det', name: 'Detroit Lions' }, { id: 'gb', name: 'Green Bay Packers' },
        { id: 'hou', name: 'Houston Texans' }, { id: 'ind', name: 'Indianapolis Colts' },
        { id: 'jax', name: 'Jacksonville Jaguars' }, { id: 'kc', name: 'Kansas City Chiefs' },
        { id: 'lv', name: 'Las Vegas Raiders' }, { id: 'lac', name: 'Los Angeles Chargers' },
        { id: 'lar', name: 'Los Angeles Rams' }, { id: 'mia', name: 'Miami Dolphins' },
        { id: 'min', name: 'Minnesota Vikings' }, { id: 'ne', name: 'New England Patriots' },
        { id: 'no', name: 'New Orleans Saints' }, { id: 'nyg', name: 'New York Giants' },
        { id: 'nyj', name: 'New York Jets' }, { id: 'phi', name: 'Philadelphia Eagles' },
        { id: 'pit', name: 'Pittsburgh Steelers' }, { id: 'sf', name: 'San Francisco 49ers' },
        { id: 'sea', name: 'Seattle Seahawks' }, { id: 'tb', name: 'Tampa Bay Buccaneers' },
        { id: 'ten', name: 'Tennessee Titans' }, { id: 'was', name: 'Washington Commanders' }
    ];

    const handleAuth = async () => {
        if (!email || !password) return;
        
        if (!isLogin) {
            if (!favoriteTeam) {
                setAuthError("Please select your favorite NFL team.");
                return;
            }
            if (password !== confirmPassword) {
                setAuthError("Passwords do not match. Please try again.");
                return;
            }
        }
        
        setLoading(true);
        setAuthError('');
        
        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            favorite_team: favoriteTeam,
                            newsletter_opt_in: newsletterOptIn
                        }
                    }
                });
                if (error) throw error;

                if (data?.user) {
                    await supabase.from('profiles').upsert({ 
                        id: data.user.id, 
                        favorite_team: favoriteTeam,
                        newsletter_opt_in: newsletterOptIn 
                    });

                    // Optional call to trigger automated subscription in Resend
                    if (newsletterOptIn) {
                        fetch('/api/enroll-subscriber', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: data.user.email })
                        }).catch((err) => console.error("Newsletter enrollment error:", err));
                    }
                }
            }
            
            const returnUrl = localStorage.getItem('returnUrl');
            if (returnUrl) {
                localStorage.removeItem('returnUrl');
                navigate(returnUrl);
            } else {
                navigate(isLogin ? '/' : '/add-league');
            }
        } catch (error) {
            setAuthError(error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAuth();
        }
    };

    return (
        <div className={styles.loginLayout}>
            <div className={styles.brandSide}>
                <div className={styles.brandContent}>
                    <img src="/brand.png" alt="League Brand" className={styles.brandLogo} />
                    <div className={styles.brandSummary}>
                        The ultimate custom platform for your fantasy football league. Sync your <strong>Sleeper</strong> leagues, track historical records, and manage your empire all in one place.
                        <div className={styles.futurePlatforms}>* Integrations for Yahoo, ESPN, and other platforms are currently in the works.</div>
                    </div>
                </div>
            </div>
            
            <div className={styles.formSide}>
                <div className={styles.glassBox}>
                    {authError && <div className={styles.error}>{authError}</div>}
                    
                    <input 
                        type="email" 
                        className={styles.inputField} 
                        placeholder="Email" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={handleKeydown} 
                    />
                    <input 
                        type="password" 
                        className={styles.inputField} 
                        placeholder="Password" 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={handleKeydown} 
                    />
                    
                    {!isLogin && (
                        <>
                            <input 
                                type="password" 
                                className={styles.inputField} 
                                placeholder="Retype Password" 
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                onKeyDown={handleKeydown} 
                            />
                            <select 
                                className={styles.inputField} 
                                value={favoriteTeam}
                                onChange={(e) => setFavoriteTeam(e.target.value)}
                            >
                                <option value="" disabled>-- Favorite NFL Team --</option>
                                {nflTeams.map((team) => (
                                    <option key={team.id} value={team.id}>{team.name}</option>
                                ))}
                            </select>

                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                fontSize: '0.85em',
                                color: '#cbd5e1',
                                cursor: 'pointer',
                                margin: '14px 0 6px 0',
                                textAlign: 'left',
                                userSelect: 'none'
                            }}>
                                <input 
                                    type="checkbox" 
                                    checked={newsletterOptIn} 
                                    onChange={(e) => setNewsletterOptIn(e.target.checked)}
                                    style={{ accentColor: '#eebf1c', width: '16px', height: '16px', cursor: 'pointer' }}
                                />
                                <span>Send me fantasy updates, trial alerts, and newsletters</span>
                            </label>
                        </>
                    )}
                    
                    <button className={styles.goldBtn} onClick={handleAuth} disabled={loading}>
                        {loading ? '...' : (isLogin ? 'ENTER' : 'JOIN')}
                    </button>
                    
                    <div 
                        className={styles.toggleLink} 
                        onClick={() => { setIsLogin(!isLogin); setAuthError(''); setConfirmPassword(''); }}
                    >
                        {isLogin ? "NEW?" : "RETURNING?"} <span>{isLogin ? 'CREATE ACCOUNT' : 'LOGIN'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}