import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import styles from './AddLeague.module.css';

export default function AddLeague() {
    const navigate = useNavigate();
    const { loadLeagueContext } = useLeague();
    
    // UI & Flow State
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    // Form State
    const [platform, setPlatform] = useState('sleeper');
    const [username, setUsername] = useState('');
    const [sleeperUserId, setSleeperUserId] = useState('');
    const [leagues, setLeagues] = useState([]);
    const [selectedLeagueId, setSelectedLeagueId] = useState('');
    const [isCommissioner, setIsCommissioner] = useState(false);

    // STEP 1: Fetch User & Leagues from Sleeper
    const handleSearchLeagues = async () => {
        if (!username.trim()) {
            setError("Please enter your username.");
            return;
        }

        setLoading(true);
        setError('');

        try {
            const userRes = await fetch(`https://api.sleeper.app/v1/user/${username.trim()}`);
            const userData = await userRes.json();

            if (!userRes.ok || !userData || !userData.user_id) {
                setError("User not found. Please check your Sleeper username.");
                setLoading(false);
                return;
            }

            setSleeperUserId(userData.user_id); // Save exact ID for foolproof matching

            const currentYear = new Date().getFullYear();
            const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${userData.user_id}/leagues/nfl/${currentYear}`);
            const leaguesData = await leaguesRes.json();

            if (!leaguesRes.ok || !leaguesData || leaguesData.length === 0) {
                setError(`No active NFL leagues found for ${currentYear}.`);
                setLoading(false);
                return;
            }

            setLeagues(leaguesData);
            setStep(2);
        } catch (err) {
            console.error("Failed to fetch from Sleeper:", err);
            setError("An error occurred while contacting Sleeper. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // STEP 2: Save the Selected League to Supabase
    const handleConnectLeague = async () => {
        if (!selectedLeagueId) {
            setError("Please select a league to connect.");
            return;
        }

        setLoading(true);
        setError('');

        try {
            const leagueToConnect = leagues.find(l => l.league_id === selectedLeagueId);

            let { data: existingLeague } = await supabase
                .from('leagues')
                .select('id')
                .eq('sleeper_league_id', leagueToConnect.league_id)
                .single();

            let dbLeagueId;

            if (!existingLeague) {
                const { data: newLeague, error: insertErr } = await supabase
                    .from('leagues')
                    .insert({
                        sleeper_league_id: leagueToConnect.league_id,
                        league_name: leagueToConnect.name,
                        platform: platform
                    })
                    .select()
                    .single();

                if (insertErr) throw insertErr;
                dbLeagueId = newLeague.id;
            } else {
                dbLeagueId = existingLeague.id;
            }

            // Infallible Auto-Detection using Sleeper User ID
            let autoTeamName = 'Commissioner Team'; 
            try {
                const [uRes] = await Promise.all([
                    fetch(`https://api.sleeper.app/v1/league/${leagueToConnect.league_id}/users`)
                ]);
                
                if (uRes.ok) {
                    const uData = await uRes.json();
                    const matchedUser = uData.find(u => u.user_id === sleeperUserId);
                    if (matchedUser) {
                        autoTeamName = matchedUser.metadata?.team_name || matchedUser.display_name;
                    }
                }
            } catch (autoErr) {
                console.warn("Could not auto-detect team name:", autoErr);
            }

            const { data: { session } } = await supabase.auth.getSession();
            
            if (session?.user) {
                const { error: linkErr } = await supabase
                    .from('user_leagues')
                    .upsert({
                        user_id: session.user.id,
                        league_id: dbLeagueId,
                        is_commissioner: isCommissioner,
                        team_name: autoTeamName
                    }, { onConflict: 'user_id, league_id' });

                if (linkErr) throw linkErr;

                await loadLeagueContext(session.user.id, dbLeagueId);
                navigate('/');
            } else {
                setError("Authentication error. Please log in again.");
                navigate('/login');
            }

        } catch (err) {
            console.error("Failed to connect league:", err);
            setError("An unexpected error occurred. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (step === 1) handleSearchLeagues();
            if (step === 2) handleConnectLeague();
        }
    };

    return (
        <div className={styles.layout}>
            <div className={styles.glassBox}>
                <div className={styles.header}>
                    <img src="/brand.png" alt="Huddle Logo" className={styles.logo} />
                    <h1 className={styles.title}>Connect Your League</h1>
                    <p className={styles.subtitle}>
                        {step === 1 ? "Select your platform and enter your username to find your leagues." : "Select the league you want to sync with your Huddle hub."}
                    </p>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                {step === 1 && (
                    <div className={styles.stepContainer}>
                        <div className={styles.formGroup}>
                            <select 
                                className={styles.inputField} 
                                value={platform}
                                onChange={(e) => setPlatform(e.target.value)}
                            >
                                <option value="sleeper">Sleeper</option>
                                <option value="yahoo" disabled>Yahoo (Coming Soon)</option>
                                <option value="espn" disabled>ESPN (Coming Soon)</option>
                            </select>
                        </div>
                        
                        <div className={styles.formGroup}>
                            <input 
                                type="text" 
                                className={styles.inputField} 
                                placeholder={`${platform.charAt(0).toUpperCase() + platform.slice(1)} Username`} 
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                onKeyDown={handleKeydown}
                            />
                        </div>

                        <button 
                            className={styles.goldBtn} 
                            onClick={handleSearchLeagues} 
                            disabled={loading}
                        >
                            {loading ? 'SEARCHING...' : 'FIND LEAGUES'}
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className={styles.stepContainer}>
                        <div className={styles.leagueList}>
                            {leagues.map(l => (
                                <div 
                                    key={l.league_id} 
                                    className={`${styles.leagueCard} ${selectedLeagueId === l.league_id ? styles.activeCard : ''}`}
                                    onClick={() => setSelectedLeagueId(l.league_id)}
                                >
                                    <div 
                                        className={styles.leagueAvatar} 
                                        style={{ backgroundImage: `url(https://sleepercdn.com/avatars/thumbs/${l.avatar}), url(https://sleepercdn.com/images/v2/icons/league_default.webp)` }} 
                                    />
                                    <div className={styles.leagueName}>{l.name}</div>
                                    <div className={styles.leagueMeta}>{l.total_rosters} Teams</div>
                                </div>
                            ))}
                        </div>

                        <label className={styles.checkboxContainer}>
                            <input 
                                type="checkbox" 
                                checked={isCommissioner} 
                                onChange={(e) => setIsCommissioner(e.target.checked)} 
                            />
                            <span className={styles.checkmark}></span>
                            I am the Commissioner of this league
                        </label>

                        <div className={styles.buttonRow}>
                            <button className={styles.backBtn} onClick={() => setStep(1)} disabled={loading}>
                                BACK
                            </button>
                            <button className={styles.goldBtn} onClick={handleConnectLeague} disabled={loading || !selectedLeagueId}>
                                {loading ? 'SYNCING...' : 'CONNECT LEAGUE'}
                            </button>
                        </div>
                    </div>
                )}

                <div className={styles.cancelLink} onClick={() => navigate(-1)}>
                    Cancel and go back
                </div>
            </div>
        </div>
    );
}