import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import styles from './AddLeague.module.css';

export default function AddLeague() {
    const navigate = useNavigate();
    const { loadLeagueContext, isPremium, leagueCount, setShowPremiumModal } = useLeague();
    
    const [userId, setUserId] = useState(null);
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    const [username, setUsername] = useState('');
    const [sleeperUserId, setSleeperUserId] = useState('');
    const [leagues, setLeagues] = useState([]);
    const [selectedLeagueIds, setSelectedLeagueIds] = useState([]);
    const [isCommissioner, setIsCommissioner] = useState(false);

    useEffect(() => {
        const fetchSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) setUserId(session.user.id);
        };
        fetchSession();
    }, []);

    const handleSearchLeagues = async () => {
        if (!username.trim()) return setError("Please enter your username.");
        setLoading(true); setError('');
        try {
            const userRes = await fetch(`https://api.sleeper.app/v1/user/${username.trim()}`);
            const userData = await userRes.json();
            if (!userRes.ok || !userData || !userData.user_id) throw new Error("User not found.");
            
            setSleeperUserId(userData.user_id);
            const currentYear = new Date().getFullYear();
            const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${userData.user_id}/leagues/nfl/${currentYear}`);
            const leaguesData = await leaguesRes.json();
            
            if (!leaguesRes.ok || !leaguesData || leaguesData.length === 0) throw new Error("No active leagues found.");
            setLeagues(leaguesData);
            setStep(2);
        } catch (err) {
            setError(err.message || "An error occurred while contacting Sleeper.");
        } finally {
            setLoading(false);
        }
    };

    const toggleLeagueSelection = (id) => {
        setSelectedLeagueIds(prev => prev.includes(id) ? prev.filter(lId => lId !== id) : [...prev, id]);
    };

    const handleConnectLeagues = async () => {
        if (selectedLeagueIds.length === 0) return setError("Select a league.");
        
        // --- PAYWALL CHECK ---
        if (!isPremium && (leagueCount + selectedLeagueIds.length > 2)) {
            setShowPremiumModal(true);
            return;
        }

        setLoading(true); setError('');
        try {
            let firstDbLeagueId = null;
            for (const sleeperId of selectedLeagueIds) {
                const leagueToConnect = leagues.find(l => l.league_id === sleeperId);
                
                let { data: existingLeague } = await supabase.from('leagues').select('id').eq('sleeper_league_id', leagueToConnect.league_id).maybeSingle();
                let dbLeagueId = existingLeague?.id;
                
                if (!existingLeague) {
                    const { data: newLeague, error: insertErr } = await supabase.from('leagues')
                        .insert({ sleeper_league_id: leagueToConnect.league_id, league_name: leagueToConnect.name, platform: 'sleeper' })
                        .select().single();
                    if (insertErr) throw insertErr;
                    dbLeagueId = newLeague.id;
                }
                
                if (!firstDbLeagueId) firstDbLeagueId = dbLeagueId;
                
                let autoTeamName = 'Commissioner Team'; 
                try {
                    const uRes = await fetch(`https://api.sleeper.app/v1/league/${leagueToConnect.league_id}/users`);
                    if (uRes.ok) {
                        const uData = await uRes.json();
                        const matchedUser = uData.find(u => u.user_id === sleeperUserId);
                        if (matchedUser) autoTeamName = matchedUser.metadata?.team_name || matchedUser.display_name;
                    }
                } catch (autoErr) {}
                
                if (userId) {
                    await supabase.from('user_leagues').upsert({
                        user_id: userId, league_id: dbLeagueId, is_commissioner: isCommissioner, team_name: autoTeamName
                    }, { onConflict: 'user_id, league_id' });
                }
            }
            await loadLeagueContext(userId, firstDbLeagueId);
            navigate('/');
        } catch (err) {
            setError("An error occurred during sync.");
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
                    <p className={styles.subtitle}>{step === 1 ? "Connect your external fantasy provider." : "Select leagues to sync."}</p>
                </div>
                {error && <div className={styles.error}>{error}</div>}
                
                {step === 1 && (
                    <div className={styles.stepContainer}>
                        <div className={styles.platformSection}>
                            <label className={styles.platformLabel}>Sleeper Integration</label>
                            <input type="text" className={styles.inputField} placeholder="Sleeper Username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearchLeagues()} />
                            <button className={styles.sleeperBtn} onClick={handleSearchLeagues} disabled={loading}>{loading ? 'SEARCHING...' : 'SYNC SLEEPER'}</button>
                        </div>
                    </div>
                )}
                
                {step === 2 && (
                    <div className={styles.stepContainer}>
                        <div className={styles.leagueList}>
                            {leagues.map(l => (
                                <div key={l.league_id} className={`${styles.leagueCard} ${selectedLeagueIds.includes(l.league_id) ? styles.activeCard : ''}`} onClick={() => toggleLeagueSelection(l.league_id)}>
                                    <div className={styles.checkboxWrapper}><div className={`${styles.checkCircle} ${selectedLeagueIds.includes(l.league_id) ? styles.checked : ''}`}></div></div>
                                    <div className={styles.leagueAvatar} style={{ backgroundImage: `url(https://sleepercdn.com/avatars/thumbs/${l.avatar}), url(https://sleepercdn.com/images/v2/icons/league_default.webp)` }} />
                                    <div className={styles.leagueNameWrapper}>
                                        <div className={styles.leagueName}>{l.name}</div>
                                        <div className={styles.leagueMeta}>{l.total_rosters} Teams</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <label className={styles.checkboxContainer}>
                            <input type="checkbox" checked={isCommissioner} onChange={(e) => setIsCommissioner(e.target.checked)} />
                            <span className={styles.checkmark}></span>
                            I am the Commissioner
                        </label>
                        <div className={styles.buttonRow}>
                            <button className={styles.backBtn} onClick={() => setStep(1)} disabled={loading}>BACK</button>
                            <button className={styles.goldBtn} onClick={handleConnectLeagues} disabled={loading || selectedLeagueIds.length === 0}>{loading ? 'SYNCING...' : 'CONNECT LEAGUES'}</button>
                        </div>
                    </div>
                )}
                <div className={styles.cancelLink} onClick={() => navigate(-1)}>Cancel and go back</div>
            </div>
        </div>
    );
}