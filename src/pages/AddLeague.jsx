import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import styles from './AddLeague.module.css';

export default function AddLeague() {
    const navigate = useNavigate();
    const { loadLeagueContext } = useLeague();
    
    // Auth State
    const [userId, setUserId] = useState(null);
    
    // UI & Flow State
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    // Form State
    const [username, setUsername] = useState('');
    const [sleeperUserId, setSleeperUserId] = useState('');
    const [leagues, setLeagues] = useState([]);
    const [selectedLeagueIds, setSelectedLeagueIds] = useState([]); // Array for multi-select
    const [isCommissioner, setIsCommissioner] = useState(false);

    // Grab user session on mount
    useEffect(() => {
        const fetchSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUserId(session.user.id);
            }
        };
        fetchSession();
    }, []);

    // --- SLEEPER FLOW: STEP 1 ---
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

            setSleeperUserId(userData.user_id);
            
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

    // --- SLEEPER FLOW: TOGGLE CHECKLIST ---
    const toggleLeagueSelection = (id) => {
        setSelectedLeagueIds(prev => 
            prev.includes(id) ? prev.filter(lId => lId !== id) : [...prev, id]
        );
    };

    // --- SLEEPER FLOW: STEP 2 (BATCH SAVE) ---
    const handleConnectLeagues = async () => {
        if (selectedLeagueIds.length === 0) {
            setError("Please select at least one league to connect.");
            return;
        }

        setLoading(true);
        setError('');

        try {
            let firstDbLeagueId = null;

            // Loop through every selected league to fetch unique data and save
            for (const sleeperId of selectedLeagueIds) {
                const leagueToConnect = leagues.find(l => l.league_id === sleeperId);
                
                let { data: existingLeague } = await supabase
                    .from('leagues')
                    .select('id')
                    .eq('sleeper_league_id', leagueToConnect.league_id)
                    .maybeSingle();
                
                let dbLeagueId;

                if (!existingLeague) {
                    const { data: newLeague, error: insertErr } = await supabase
                        .from('leagues')
                        .insert({
                            sleeper_league_id: leagueToConnect.league_id,
                            league_name: leagueToConnect.name,
                            platform: 'sleeper'
                        })
                        .select()
                        .single();

                    if (insertErr) throw insertErr;
                    dbLeagueId = newLeague.id;
                } else {
                    dbLeagueId = existingLeague.id;
                }

                if (!firstDbLeagueId) firstDbLeagueId = dbLeagueId;

                // Auto-detect team name for this specific league
                let autoTeamName = 'Commissioner Team'; 
                try {
                    const uRes = await fetch(`https://api.sleeper.app/v1/league/${leagueToConnect.league_id}/users`);
                    if (uRes.ok) {
                        const uData = await uRes.json();
                        const matchedUser = uData.find(u => u.user_id === sleeperUserId);
                        if (matchedUser) {
                            autoTeamName = matchedUser.metadata?.team_name || matchedUser.display_name;
                        }
                    }
                } catch (autoErr) {
                    console.warn(`Could not auto-detect team name for ${leagueToConnect.name}:`, autoErr);
                }
                
                // Link user to this league
                if (userId) {
                    const { error: linkErr } = await supabase
                        .from('user_leagues')
                        .upsert({
                            user_id: userId,
                            league_id: dbLeagueId,
                            is_commissioner: isCommissioner,
                            team_name: autoTeamName
                        }, { onConflict: 'user_id, league_id' });

                    if (linkErr) throw linkErr;
                } else {
                    throw new Error("Authentication error. Please log in again.");
                }
            }

            // Sync context to the first league selected and push to dashboard
            await loadLeagueContext(userId, firstDbLeagueId);
            navigate('/');
            
        } catch (err) {
            console.error("Failed to connect leagues:", err);
            setError("An unexpected error occurred. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (step === 1) handleSearchLeagues();
        }
    };

    return (
        <div className={styles.layout}>
            <div className={styles.glassBox}>
                <div className={styles.header}>
                    <img src="/brand.png" alt="Huddle Logo" className={styles.logo} />
                    <h1 className={styles.title}>Connect Your League</h1>
                    <p className={styles.subtitle}>
                        {step === 1 ? "Connect your external fantasy provider to import your current rosters and history into Huddle FF." : "Select the leagues you want to sync with your Huddle hub."}
                    </p>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                {step === 1 && (
                    <div className={styles.stepContainer}>
                        
                        {/* Sleeper Section */}
                        <div className={styles.platformSection}>
                            <label className={styles.platformLabel}>Sleeper Integration</label>
                            <div className={styles.formGroup} style={{ marginBottom: '15px' }}>
                                <input 
                                    type="text" 
                                    className={styles.inputField} 
                                    placeholder="Sleeper Username" 
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    onKeyDown={handleKeydown}
                                />
                            </div>
                            <button 
                                className={styles.sleeperBtn} 
                                onClick={handleSearchLeagues} 
                                disabled={loading}
                            >
                                {loading ? 'SEARCHING...' : 'SYNC SLEEPER'}
                            </button>
                        </div>

                    </div>
                )}

                {step === 2 && (
                    <div className={styles.stepContainer}>
                        <div className={styles.leagueList}>
                            {leagues.map(l => (
                                <div 
                                    key={l.league_id} 
                                    className={`${styles.leagueCard} ${selectedLeagueIds.includes(l.league_id) ? styles.activeCard : ''}`}
                                    onClick={() => toggleLeagueSelection(l.league_id)}
                                >
                                    <div className={styles.checkboxWrapper}>
                                        <div className={`${styles.checkCircle} ${selectedLeagueIds.includes(l.league_id) ? styles.checked : ''}`}></div>
                                    </div>
                                    <div 
                                        className={styles.leagueAvatar} 
                                        style={{ backgroundImage: `url(https://sleepercdn.com/avatars/thumbs/${l.avatar}), url(https://sleepercdn.com/images/v2/icons/league_default.webp)` }} 
                                    />
                                    <div className={styles.leagueNameWrapper}>
                                        <div className={styles.leagueName}>{l.name}</div>
                                        <div className={styles.leagueMeta}>{l.total_rosters} Teams</div>
                                    </div>
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
                            I am the Commissioner of these leagues
                        </label>

                        <div className={styles.buttonRow}>
                            <button className={styles.backBtn} onClick={() => setStep(1)} disabled={loading}>
                                BACK
                            </button>
                            <button className={styles.goldBtn} onClick={handleConnectLeagues} disabled={loading || selectedLeagueIds.length === 0}>
                                {loading ? 'SYNCING...' : 'CONNECT LEAGUES'}
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