import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { fetchAndNormalizeESPNLeague } from '../utils/espnService';
import styles from './AddLeague.module.css';

export default function AddLeague() {
    const navigate = useNavigate();
    const { loadLeagueContext } = useLeague();
    
    const [activeTab, setActiveTab] = useState('sleeper');
    
    const [sleeperUsername, setSleeperUsername] = useState('');
    
    const [espnLeagueId, setEspnLeagueId] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);
    const [espnS2, setEspnS2] = useState('');
    const [swid, setSwid] = useState('');
    
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [foundLeagues, setFoundLeagues] = useState([]);

    const currentYear = new Date().getFullYear();

    const searchSleeper = async (e) => {
        e.preventDefault();
        if (!sleeperUsername.trim()) return;
        setLoading(true);
        setErrorMsg(null);
        setFoundLeagues([]);

        try {
            const userRes = await fetch(`https://api.sleeper.app/v1/user/${sleeperUsername.trim()}`);
            if (!userRes.ok) throw new Error("Could not find Sleeper user.");
            const userData = await userRes.json();
            if (!userData || !userData.user_id) throw new Error("Invalid Sleeper username.");

            const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${userData.user_id}/leagues/nfl/${currentYear}`);
            if (!leaguesRes.ok) throw new Error("Could not fetch Sleeper leagues.");
            const leaguesData = await leaguesRes.json();

            if (!leaguesData || leaguesData.length === 0) {
                throw new Error(`No active leagues found for ${currentYear}.`);
            }

            const formattedLeagues = leaguesData.map(l => ({
                id: String(l.league_id),
                name: l.name,
                avatar: l.avatar ? `https://sleepercdn.com/avatars/thumbs/${l.avatar}` : '/brand.png',
                platform: 'sleeper'
            }));

            setFoundLeagues(formattedLeagues);
        } catch (err) {
            setErrorMsg(err.message);
        } finally {
            setLoading(false);
        }
    };

    const searchESPN = async (e) => {
        e.preventDefault();
        if (!espnLeagueId.trim()) return;
        setLoading(true);
        setErrorMsg(null);
        setFoundLeagues([]);

        try {
            const cookies = isPrivate ? { espn_s2: espnS2.trim(), swid: swid.trim() } : {};
            const normalized = await fetchAndNormalizeESPNLeague(espnLeagueId, cookies);

            if (!normalized) {
                throw new Error("Could not locate ESPN league. Verify the ID and try again.");
            }

            setFoundLeagues([{
                id: normalized.id,
                name: normalized.name,
                avatar: normalized.avatar,
                platform: 'espn',
                cookies: isPrivate ? cookies : null
            }]);
        } catch (err) {
            setErrorMsg(err.message || "Failed to connect to ESPN league.");
        } finally {
            setLoading(false);
        }
    };

    const connectLeague = async (league) => {
        setLoading(true);
        setErrorMsg(null);
        try {
            const { data: { session }, error: authErr } = await supabase.auth.getSession();
            if (authErr || !session?.user) throw new Error("You must be logged in to connect a league.");

            const userId = session.user.id;

            // 1. Resolve the Database UUID for the league
            let dbLeagueId;
            const queryColumn = league.platform === 'sleeper' ? 'sleeper_league_id' : 'id';
            
            const { data: existingLeague } = await supabase
                .from('leagues')
                .select('id')
                .eq(queryColumn, league.id)
                .maybeSingle();

            if (existingLeague) {
                dbLeagueId = existingLeague.id;
            } else {
                // Insert into leagues table to generate the UUID
                const { data: newLeague, error: newLeagueErr } = await supabase
                    .from('leagues')
                    .insert({
                        [queryColumn]: league.id,
                        name: league.name,
                        avatar: league.avatar,
                        platform: league.platform
                    })
                    .select('id')
                    .single();

                if (newLeagueErr) throw new Error("Failed to register the new league in the database.");
                dbLeagueId = newLeague.id;
            }

            // 2. Check for an existing connection using the UUID
            const { data: existing } = await supabase
                .from('user_leagues')
                .select('*')
                .eq('user_id', userId)
                .eq('league_id', dbLeagueId)
                .maybeSingle();

            if (existing) {
                throw new Error("You are already connected to this league.");
            }

            // 3. Insert the user connection using the UUID
            const { error: insertErr } = await supabase.from('user_leagues').insert({
                user_id: userId,
                league_id: dbLeagueId,
                platform: league.platform,
                team_name: league.name
            });

            if (insertErr) throw insertErr;

            await loadLeagueContext(userId, dbLeagueId);
            navigate('/');
        } catch (err) {
            setErrorMsg(err.message);
            setLoading(false);
        }
    };

    return (
        <div className={styles.pageContainer}>
            <div className={styles.card}>
                <div className={styles.header}>
                    <i className="material-icons" style={{ fontSize: '40px', color: '#eebf1c' }}>link</i>
                    <h1 className={styles.title}>Connect League</h1>
                    <p className={styles.subtitle}>Select your fantasy platform to sync your rosters and data.</p>
                </div>

                <div className={styles.tabContainer}>
                    <button 
                        type="button"
                        className={`${styles.tabBtn} ${activeTab === 'sleeper' ? styles.activeTab : ''}`}
                        onClick={() => { setActiveTab('sleeper'); setFoundLeagues([]); setErrorMsg(null); }}
                    >
                        Sleeper
                    </button>
                    <button 
                        type="button"
                        className={styles.tabBtn}
                        disabled
                        title="ESPN Integration Coming Soon"
                    >
                        ESPN (Soon)
                    </button>
                </div>

                {activeTab === 'sleeper' && (
                    <form onSubmit={searchSleeper} className={styles.searchForm}>
                        <label>Sleeper Username</label>
                        <div className={styles.inputWrapper}>
                            <input 
                                type="text" 
                                placeholder="e.g. FantasyChamp24" 
                                value={sleeperUsername}
                                onChange={(e) => setSleeperUsername(e.target.value)}
                                className={styles.inputField}
                            />
                            <button type="submit" className={styles.searchBtn} disabled={loading || !sleeperUsername}>
                                {loading ? 'Searching...' : 'Search'}
                            </button>
                        </div>
                    </form>
                )}

                {activeTab === 'espn' && (
                    <form onSubmit={searchESPN} className={styles.searchForm}>
                        <label>ESPN League ID</label>
                        <div className={styles.inputWrapper}>
                            <input 
                                type="text" 
                                placeholder="e.g. 123456789" 
                                value={espnLeagueId}
                                onChange={(e) => setEspnLeagueId(e.target.value.replace(/\D/g, ''))}
                                className={styles.inputField}
                            />
                            <button type="submit" className={styles.searchBtn} disabled={loading || !espnLeagueId}>
                                {loading ? 'Connecting...' : 'Connect'}
                            </button>
                        </div>
                        <p className={styles.helperText}>Find your League ID in your ESPN URL: <i>leagueId=123456789</i></p>

                        <div className={styles.accordionToggle} onClick={() => setIsPrivate(!isPrivate)}>
                            <span>{isPrivate ? '▲ Hide Private League Settings' : '▼ Is this a Private League?'}</span>
                        </div>

                        {isPrivate && (
                            <div className={styles.privateBox}>
                                <div className={styles.cookieInputGroup}>
                                    <label>espn_s2 Cookie</label>
                                    <input 
                                        type="text" 
                                        placeholder="AEB... (long token)"
                                        value={espnS2} 
                                        onChange={(e) => setEspnS2(e.target.value)} 
                                        className={styles.inputField} 
                                    />
                                </div>
                                <div className={styles.cookieInputGroup}>
                                    <label>SWID Cookie</label>
                                    <input 
                                        type="text" 
                                        placeholder="{12345678-ABCD-...}" 
                                        value={swid} 
                                        onChange={(e) => setSwid(e.target.value)} 
                                        className={styles.inputField} 
                                    />
                                </div>
                                <p className={styles.helperText}>
                                    Found in browser DevTools (F12) → Storage/Application → Cookies → espn.com
                                </p>
                            </div>
                        )}
                    </form>
                )}

                {errorMsg && (
                    <div className={styles.errorBox}>
                        <i className="material-icons">error_outline</i> {errorMsg}
                    </div>
                )}

                {foundLeagues.length > 0 && (
                    <div className={styles.resultsContainer}>
                        <h3 className={styles.resultsTitle}>Available Leagues</h3>
                        <div className={styles.leagueList}>
                            {foundLeagues.map(league => (
                                <div key={league.id} className={styles.leagueItem}>
                                    <div className={styles.leagueInfo}>
                                        <img src={league.avatar} alt="Logo" className={styles.leagueAvatar} />
                                        <div className={styles.leagueMeta}>
                                            <span className={styles.leagueName}>{league.name}</span>
                                            <span className={styles.leaguePlatform}>
                                                {league.platform === 'sleeper' ? 'Sleeper API' : 'ESPN Fantasy'}
                                            </span>
                                        </div>
                                    </div>
                                    <button 
                                        type="button"
                                        className={styles.connectBtn} 
                                        onClick={() => connectLeague(league)}
                                        disabled={loading}
                                    >
                                        Connect
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}