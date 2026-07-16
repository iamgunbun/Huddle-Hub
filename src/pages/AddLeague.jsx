import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import styles from './AddLeague.module.css';

export default function AddLeague() {
    const navigate = useNavigate();
    const { loadLeagueContext } = useLeague();
    
    const [userId, setUserId] = useState(null);
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [username, setUsername] = useState('');
    const [leagues, setLeagues] = useState([]);
    const [selectedLeagueIds, setSelectedLeagueIds] = useState([]);
    const [isCommissioner, setIsCommissioner] = useState(false);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) setUserId(session.user.id);
        });
    }, []);

    const handleYahooConnect = () => {
        if (!userId) {
            setError("Authentication error. Please log in again.");
            return;
        }
        const clientId = import.meta.env.VITE_YAHOO_CLIENT_ID;
        const redirectUri = encodeURIComponent(import.meta.env.VITE_YAHOO_REDIRECT_URI);
        const state = encodeURIComponent(userId);
        window.location.href = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;
    };

    const handleSearchLeagues = async () => {
        if (!username.trim()) return setError("Please enter your username.");
        setLoading(true);
        setError('');
        try {
            const userRes = await fetch(`https://api.sleeper.app/v1/user/${username.trim()}`);
            const userData = await userRes.json();
            if (!userData?.user_id) throw new Error("Sleeper user not found.");
            
            const currentYear = new Date().getFullYear();
            const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${userData.user_id}/leagues/nfl/${currentYear}`);
            const leaguesData = await leaguesRes.json();
            
            if (!leaguesData || leaguesData.length === 0) throw new Error("No active leagues found.");
            
            setLeagues(leaguesData);
            setStep(2);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleLeague = (id) => {
        setSelectedLeagueIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleConnectLeagues = async () => {
        setLoading(true);
        setError('');
        try {
            let firstDbLeagueId = null;
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
                
                const { error: linkErr } = await supabase
                    .from('user_leagues')
                    .upsert({
                        user_id: userId,
                        league_id: dbLeagueId,
                        is_commissioner: isCommissioner,
                        team_name: 'Imported Team'
                    }, { onConflict: 'user_id, league_id' });
                if (linkErr) throw linkErr;
            }
            await loadLeagueContext(userId, firstDbLeagueId);
            navigate('/');
        } catch (err) {
            setError("Connection failed. Try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.layout}>
            <div className={styles.glassBox}>
                <div className={styles.header}>
                    <img src="/brand.png" alt="Huddle Logo" className={styles.logo} />
                    <h1 className={styles.title}>Connect Your League</h1>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                {step === 1 ? (
                    <div className={styles.stepContainer}>
                        <div className={styles.platformSection}>
                            <label className={styles.platformLabel}>Sleeper Integration</label>
                            <input 
                                className={styles.inputField} 
                                placeholder="Sleeper Username" 
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                            <button className={styles.goldBtn} onClick={handleSearchLeagues}>Find Leagues</button>
                        </div>
                        <div className={styles.divider}><span>OR</span></div>
                        <button className={styles.yahooBtn} onClick={handleYahooConnect}>Connect Yahoo</button>
                    </div>
                ) : (
                    <div className={styles.stepContainer}>
                        <div className={styles.leagueList}>
                            {leagues.map(l => (
                                <div 
                                    key={l.league_id} 
                                    className={`${styles.leagueCard} ${selectedLeagueIds.includes(l.league_id) ? styles.activeCard : ''}`}
                                    onClick={() => toggleLeague(l.league_id)}
                                >
                                    <div className={`${styles.checkbox} ${selectedLeagueIds.includes(l.league_id) ? styles.checked : ''}`}></div>
                                    <img src={`https://sleepercdn.com/avatars/thumbs/${l.avatar}`} className={styles.avatar} />
                                    <div className={styles.name}>{l.name}</div>
                                </div>
                            ))}
                        </div>
                        <button className={styles.goldBtn} onClick={handleConnectLeagues}>CONNECT LEAGUE</button>
                        <div className={styles.cancelLink} onClick={() => setStep(1)}>Cancel and go back</div>
                    </div>
                )}
            </div>
        </div>
    );
}