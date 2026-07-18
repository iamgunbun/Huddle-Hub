import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { activeLeague as svelteActiveLeague } from '../stores/leagueContext';

const LeagueContext = createContext();

export const useLeague = () => useContext(LeagueContext);

export const LeagueProvider = ({ children }) => {
    const [activeLeague, setActiveLeague] = useState(null);
    const [userLeaguesList, setUserLeaguesList] = useState([]); 
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState(null);

    const loadLeagueContext = async (uid, specificLeagueId = null) => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('user_leagues')
                .select('league_id, is_commissioner, team_name, leagues(*)')
                .eq('user_id', uid);

            if (error) throw error;

            if (data && data.length > 0) {
                // Dynamically fetch live data from Sleeper to grab missing avatars and updated names
                const formattedLeagues = await Promise.all(data.map(async (row) => {
                    let avatarUrl = null;
                    let leagueName = row.leagues.league_name;
                    
                    if (row.leagues.platform === 'sleeper' && row.leagues.sleeper_league_id) {
                        try {
                            const res = await fetch(`https://api.sleeper.app/v1/league/${row.leagues.sleeper_league_id}`);
                            if (res.ok) {
                                const sleeperData = await res.json();
                                if (sleeperData.avatar) {
                                    avatarUrl = `https://sleepercdn.com/avatars/thumbs/${sleeperData.avatar}`;
                                }
                                if (sleeperData.name) {
                                    leagueName = sleeperData.name;
                                }
                            }
                        } catch (e) {
                            console.warn("Could not fetch sleeper data", e);
                        }
                    }

                    return {
                        ...row.leagues,
                        id: row.leagues.id,
                        sleeper_league_id: row.leagues.sleeper_league_id,
                        name: leagueName, 
                        league_name: leagueName,
                        avatar: avatarUrl,
                        is_commissioner: row.is_commissioner,
                        my_team_name: row.team_name
                    };
                }));
                
                setUserLeaguesList(formattedLeagues);

                let selected = formattedLeagues[0];
                if (specificLeagueId) {
                    const matched = formattedLeagues.find(l => l.id === specificLeagueId || l.sleeper_league_id === specificLeagueId);
                    if (matched) selected = matched;
                } else {
                    const savedLeagueId = localStorage.getItem('activeLeagueId');
                    if (savedLeagueId) {
                        const matched = formattedLeagues.find(l => l.id === savedLeagueId || l.sleeper_league_id === savedLeagueId);
                        if (matched) selected = matched;
                    }
                }

                setActiveLeague(selected);
                svelteActiveLeague.set(selected);
                localStorage.setItem('activeLeagueId', selected.id);
            } else {
                setActiveLeague(null);
                setUserLeaguesList([]);
                svelteActiveLeague.set(null);
            }
        } catch (err) {
            console.error("Error loading league context:", err);
            setActiveLeague(null);
            setUserLeaguesList([]);
            svelteActiveLeague.set(null);
        } finally {
            setLoading(false);
        }
    };

    const switchActiveLeague = async (leagueId) => {
        if (!userLeaguesList.length) return;
        const matched = userLeaguesList.find(l => l.id === leagueId || l.sleeper_league_id === leagueId);
        if (matched) {
            setActiveLeague(matched);
            svelteActiveLeague.set(matched);
            localStorage.setItem('activeLeagueId', matched.id);
        }
    };

    useEffect(() => {
        let mounted = true;

        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUserId(session.user.id);
                loadLeagueContext(session.user.id);
            } else {
                if (mounted) setLoading(false);
            }
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session?.user) {
                setLoading(true); 
                setUserId(session.user.id);
                loadLeagueContext(session.user.id);
            } else if (event === 'SIGNED_OUT') {
                setUserId(null);
                setActiveLeague(null);
                setUserLeaguesList([]);
                svelteActiveLeague.set(null);
                localStorage.removeItem('activeLeagueId');
                setLoading(false);
            }
        });

        return () => {
            mounted = false;
            if (subscription) subscription.unsubscribe();
        };
    }, []);

    return (
        <LeagueContext.Provider value={{ 
            activeLeague, 
            setActiveLeague, 
            userLeaguesList, 
            loading, 
            loadLeagueContext,
            switchActiveLeague 
        }}>
            {children}
        </LeagueContext.Provider>
    );
};