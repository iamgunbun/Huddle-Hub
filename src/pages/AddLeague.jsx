import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { fetchAndNormalizeESPNLeague } from '../utils/espnService';
import { parseYahooOwnTeams } from '../utils/yahooHistory';
import { findSleeperLeagueUser, isSleeperCommissioner } from '../utils/leagueMembership';
import styles from './AddLeague.module.css';

export default function AddLeague() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { loadLeagueContext } = useLeague();
    
    const [activeTab, setActiveTab] = useState('sleeper');
    
    // Sleeper State
    const [sleeperUsername, setSleeperUsername] = useState('');
    
    // Yahoo State
    const [isYahooLinked, setIsYahooLinked] = useState(false);
    
    // ESPN State
    const [espnLeagueId, setEspnLeagueId] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);
    const [espnS2, setEspnS2] = useState('');
    const [swid, setSwid] = useState('');
    
    // UI States
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [foundLeagues, setFoundLeagues] = useState([]);

    const currentYear = new Date().getFullYear();

    useEffect(() => {
        if (searchParams.get('linked') === 'yahoo') {
            setActiveTab('yahoo');
            setIsYahooLinked(true);
        } else if (searchParams.get('integration') === 'failed') {
            setActiveTab('yahoo');
            setErrorMsg(searchParams.get('reason') || 'Yahoo integration failed.');
        }
    }, [searchParams]);

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
                platform: 'sleeper',
                managerName: userData.display_name, // Captures precise username for user_leagues insert
                sleeperUserId: userData.user_id // Identifies the account exactly when reading commissioner status
            }));

            setFoundLeagues(formattedLeagues);
        } catch (err) {
            setErrorMsg(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Sleeper has no "my team" endpoint -- every member comes back the same --
    // so the account is found by its own user id, which is exact. A failure here
    // must not block connecting the league; it only means the commissioner tools
    // stay hidden until the next load reconciles them.
    const readSleeperCommissioner = async (league) => {
        try {
            const res = await fetch(`https://api.sleeper.app/v1/league/${league.id}/users`);
            if (!res.ok) return false;
            const users = await res.json();
            const me = findSleeperLeagueUser(users, { userId: league.sleeperUserId, teamName: league.managerName });
            return isSleeperCommissioner(me);
        } catch (err) {
            console.warn("Couldn't read Sleeper commissioner status:", err);
            return false;
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

    const fetchYahooLeagues = useCallback(async () => {
        setLoading(true);
        setErrorMsg(null);
        setFoundLeagues([]);

        try {
            const { data: { session }, error: authErr } = await supabase.auth.getSession();
            if (authErr || !session?.user) throw new Error("You must be logged in.");

            // Fetch the account's leagues, and separately the account's own teams
            // (Yahoo's "teams" collection returns only teams owned by the current
            // login) so each league can be tagged with the user's real team name --
            // without this, "connect" has no way to know which roster is theirs.
            const [leaguesRes, teamsRes] = await Promise.all([
                fetch('/api/yahoo-proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: session.user.id,
                        endpoint: 'users;use_login=1/games;game_keys=nfl/leagues'
                    })
                }),
                fetch('/api/yahoo-proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: session.user.id,
                        endpoint: 'users;use_login=1/games;game_keys=nfl/teams'
                    })
                }).catch(() => null)
            ]);

            if (leaguesRes.status === 401) {
                setIsYahooLinked(false);
                return;
            }

            if (!leaguesRes.ok) throw new Error("Failed to fetch Yahoo leagues.");

            const data = await leaguesRes.json();
            setIsYahooLinked(true);

            // The account's own team in each league: its name, and whether the
            // account runs the league. Yahoo flags the commissioner on the
            // manager record, so this is the only place that answer exists.
            const ownTeamByLeagueKey = teamsRes?.ok
                ? parseYahooOwnTeams(await teamsRes.json())
                : {};

            const leaguesArray = [];
            const games = data?.fantasy_content?.users?.[0]?.user?.[1]?.games;

            if (games) {
                const gameCount = games.count || 0;
                for (let i = 0; i < gameCount; i++) {
                    const leaguesObj = games[i]?.game?.[1]?.leagues;
                    if (leaguesObj) {
                        const leagueCount = leaguesObj.count || 0;
                        for (let j = 0; j < leagueCount; j++) {
                            const leagueData = leaguesObj[j]?.league?.[0];
                            if (leagueData) {
                                const ownTeam = ownTeamByLeagueKey[String(leagueData.league_key)];
                                leaguesArray.push({
                                    id: String(leagueData.league_key),
                                    name: leagueData.name,
                                    avatar: leagueData.logo_url || '/brand.png',
                                    platform: 'yahoo',
                                    managerName: ownTeam?.teamName || null,
                                    isCommissioner: !!ownTeam?.isCommissioner
                                });
                            }
                        }
                    }
                }
            }

            if (leaguesArray.length === 0) {
                throw new Error("No active NFL leagues found on this Yahoo account.");
            }

            setFoundLeagues(leaguesArray);
        } catch (err) {
            setErrorMsg(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (activeTab === 'yahoo') {
            fetchYahooLeagues();
        }
    }, [activeTab, fetchYahooLeagues]);

    const initiateYahooOAuth = async () => {
        setLoading(true);
        try {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (error || !session?.user) throw new Error("You must be logged in to connect a Yahoo league.");
            
            window.location.href = `/api/yahoo-auth?userId=${session.user.id}`;
        } catch (err) {
            setErrorMsg(err.message);
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

            let dbLeagueId;
            const queryColumn = (league.platform === 'sleeper' || league.platform === 'yahoo') ? 'sleeper_league_id' : 'id';
            
            const { data: existingLeague, error: selectErr } = await supabase
                .from('leagues')
                .select('id')
                .eq(queryColumn, String(league.id)) // Forces string mapping to prevent malformed syntax errors
                .maybeSingle();

            if (selectErr) {
                console.error("Lookup error:", selectErr);
                throw new Error("Database query failed while checking league existence.");
            }

            if (existingLeague) {
                dbLeagueId = existingLeague.id;
            } else {
                const { data: newLeague, error: newLeagueErr } = await supabase
                    .from('leagues')
                    .insert({
                        [queryColumn]: String(league.id),
                        league_name: league.name, // Fixed column names 
                        avatar: league.avatar, // Fixed column names
                        platform: league.platform
                    })
                    .select('id')
                    .single();

                if (newLeagueErr) {
                    console.error("Insert error:", newLeagueErr);
                    throw new Error("Failed to register the new league in the database.");
                }
                dbLeagueId = newLeague.id;
            }

            const { data: existing } = await supabase
                .from('user_leagues')
                .select('*')
                .eq('user_id', userId)
                .eq('league_id', dbLeagueId)
                .maybeSingle();

            if (existing) {
                throw new Error("You are already connected to this league.");
            }

            // Commissioner status, recorded at connect time so the tools are
            // available straight away. This was never captured on EITHER
            // platform, so it sat false for every connection regardless of the
            // truth. Yahoo states it on the account's own team (read when the
            // league list was fetched); Sleeper marks the commissioner as the
            // league's owner, which takes one more call for the chosen league.
            let isCommissioner = !!league.isCommissioner;
            if (league.platform === 'sleeper') {
                isCommissioner = await readSleeperCommissioner(league);
            }

            const { error: insertErr } = await supabase.from('user_leagues').insert({
                user_id: userId,
                league_id: dbLeagueId,
                platform: league.platform,
                team_name: league.managerName || sleeperUsername.trim() || league.name, // Safely inputs actual username
                is_commissioner: isCommissioner
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
                        className={`${styles.tabBtn} ${activeTab === 'yahoo' ? styles.activeTab : ''}`}
                        onClick={() => { setActiveTab('yahoo'); setFoundLeagues([]); setErrorMsg(null); }}
                    >
                        Yahoo
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

                {activeTab === 'yahoo' && (
                    <div style={{ textAlign: 'center', padding: '10px 0' }}>
                        <i className="material-icons" style={{ fontSize: '44px', color: '#7b00ff', marginBottom: '12px' }}>sports_football</i>
                        
                        {!isYahooLinked ? (
                            <>
                                <p style={{ color: '#cbd5e1', fontSize: '0.85em', lineHeight: '1.5', marginBottom: '20px' }}>
                                    To connect your Yahoo Fantasy leagues, Huddle requires secure authorization to access your roster and matchup data.
                                </p>
                                <button 
                                    onClick={initiateYahooOAuth} 
                                    disabled={loading}
                                    style={{ background: '#7b00ff', color: '#fff', border: 'none', padding: '12px 20px', borderRadius: '8px', fontWeight: '800', fontSize: '0.9em', textTransform: 'uppercase', cursor: 'pointer', width: '100%', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
                                >
                                    {loading ? 'Redirecting...' : 'Link Yahoo Account'}
                                </button>
                            </>
                        ) : (
                            <>
                                <p style={{ color: '#00ceb8', fontSize: '0.9em', fontWeight: '700', marginBottom: '15px' }}>
                                    Yahoo Account Linked
                                </p>
                                <button 
                                    onClick={fetchYahooLeagues} 
                                    disabled={loading}
                                    className={styles.searchBtn}
                                    style={{ width: '100%', padding: '12px 20px', fontSize: '0.9em' }}
                                >
                                    {loading ? 'Fetching Leagues...' : 'Refresh Yahoo Leagues'}
                                </button>
                            </>
                        )}
                    </div>
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
                                                {league.platform === 'sleeper' ? 'Sleeper API' : league.platform === 'yahoo' ? 'Yahoo Fantasy' : 'ESPN Fantasy'}
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