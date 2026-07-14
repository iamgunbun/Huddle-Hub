import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import styles from './Invite.module.css';

export default function Invite() {
    const { league_id } = useParams();
    const navigate = useNavigate();
    const { loadLeagueContext, switchActiveLeague } = useLeague();
    
    const [loading, setLoading] = useState(true);
    const [leagueName, setLeagueName] = useState('...');
    const [sleeperLeagueId, setSleeperLeagueId] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    
    const [pageError, setPageError] = useState(null);
    const [formError, setFormError] = useState(null);
    const [sleeperUsername, setSleeperUsername] = useState('');

    useEffect(() => {
        const initInvite = async () => {
            setLoading(true);
            try {
                // 1. Fetch the league name and sleeper ID to verify against
                const { data: league, error: leagueErr } = await supabase
                    .from('leagues')
                    .select('league_name, sleeper_league_id')
                    .eq('id', league_id)
                    .single();
                
                if (leagueErr || !league) {
                    setPageError("Invalid or expired invite link.");
                    setLoading(false);
                    return;
                }
                
                setLeagueName(league.league_name);
                setSleeperLeagueId(league.sleeper_league_id);

                // 2. Use getUser() instead of getSession() for a secure server-side check.
                // This prevents foreign key crashes if a user was deleted from the database but still has a local token.
                const { data: { user }, error: authErr } = await supabase.auth.getUser();
                
                if (user && !authErr) {
                    setCurrentUser(user);
                } else {
                    // Wipe any corrupted local sessions just to be safe
                    await supabase.auth.signOut();
                    setCurrentUser(null);
                }

            } catch (err) {
                setPageError("An error occurred loading the invite.");
            } finally {
                setLoading(false);
            }
        };
        initInvite();
    }, [league_id]);

    const handleLoginRedirect = () => {
        // Drop a breadcrumb so Login/Signup knows to send them back here
        localStorage.setItem('returnUrl', window.location.pathname);
        navigate('/login');
    };

    const handleJoin = async () => {
        if (!sleeperUsername.trim()) {
            setFormError("Please enter your Sleeper username.");
            return;
        }

        setLoading(true);
        setFormError(null);

        try {
            // 1. Fetch the user's specific Sleeper ID based on the username they entered
            const userRes = await fetch(`https://api.sleeper.app/v1/user/${sleeperUsername.trim()}`);
            const sleeperUser = await userRes.json();
            
            if (!userRes.ok || !sleeperUser || !sleeperUser.user_id) {
                throw new Error("Sleeper user not found. Please check your spelling.");
            }

            // 2. Fetch the roster of users actually in the invited league
            const leagueUsersRes = await fetch(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/users`);
            const leagueUsers = await leagueUsersRes.json();

            if (!leagueUsersRes.ok || !leagueUsers) {
                throw new Error("Could not verify league members with Sleeper.");
            }

            // 3. Verify the user is officially in this league
            const matchedUser = leagueUsers.find(u => u.user_id === sleeperUser.user_id);
            
            if (!matchedUser) {
                throw new Error(`The username "${sleeperUsername}" is not a member of ${leagueName}.`);
            }

            // 4. Extract their exact team name / identity
            const finalTeamName = matchedUser.metadata?.team_name || matchedUser.display_name;

            // 5. Lock their perfectly matched identity into Supabase
            const { error: joinErr } = await supabase
                .from('user_leagues')
                .upsert({
                    user_id: currentUser.id,
                    league_id: league_id,
                    is_commissioner: false, 
                    team_name: finalTeamName
                }, { onConflict: 'user_id, league_id' });

            if (joinErr) throw joinErr;

            await loadLeagueContext(currentUser.id, league_id);
            await switchActiveLeague(league_id);
            navigate('/');
            
        } catch (err) {
            setFormError(err.message);
            setLoading(false);
        }
    };

    // If the league doesn't exist in our database
    if (pageError) {
        return (
            <div className={styles.container}>
                <div className={styles.glassBox}>
                    <i className="material-icons" style={{ fontSize: '48px', color: '#ef4444' }}>error_outline</i>
                    <h2 style={{ color: '#f8fafc' }}>Invite Error</h2>
                    <p style={{ color: '#94a3b8' }}>{pageError}</p>
                    <button className={styles.goldBtn} onClick={() => navigate('/')}>Go Home</button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.glassBox}>
                    <h2 style={{ color: '#eebf1c', textTransform: 'uppercase', letterSpacing: '2px' }}>Loading Invite...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.glassBox}>
                <i className="material-icons" style={{ fontSize: '64px', color: '#eebf1c', marginBottom: '15px' }}>mark_email_read</i>
                <h1 className={styles.title}>You've been invited!</h1>
                <p className={styles.subtitle}>Join <strong>{leagueName}</strong> on Huddle.</p>
                
                {formError && <div className={styles.errorBox}>{formError}</div>}

                {currentUser ? (
                    <div className={styles.formGroup}>
                        <p className={styles.instructions}>Verify your identity to claim your team:</p>
                        <input 
                            type="text" 
                            className={styles.inputField} 
                            placeholder="Sleeper Username" 
                            value={sleeperUsername}
                            onChange={(e) => setSleeperUsername(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        />
                        <button className={styles.goldBtn} onClick={handleJoin} disabled={loading}>
                            {loading ? 'Verifying...' : 'Verify & Join'}
                        </button>
                    </div>
                ) : (
                    <div className={styles.formGroup}>
                        <p className={styles.instructions} style={{ marginBottom: '15px' }}>
                            You need a Huddle account to accept this invite.
                        </p>
                        <button className={styles.goldBtn} onClick={handleLoginRedirect}>
                            Log in / Sign up to Claim
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}