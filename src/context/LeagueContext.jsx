import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { getLeagueData } from '../utils/helper';

const LeagueContext = createContext();

export const LeagueProvider = ({ children }) => {
    const [activeLeague, setActiveLeague] = useState(null);
    const [userLeaguesList, setUserLeaguesList] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadLeagueContext = async (userId, targetLeagueId = null) => {
        setLoading(true);
        try {
            const { data: userLeagues, error: linkError } = await supabase
                .from('user_leagues')
                .select(`league_id, is_commissioner, leagues ( sleeper_league_id, league_name )`)
                .eq('user_id', userId);

            if (linkError || !userLeagues || userLeagues.length === 0) {
                setLoading(false);
                return;
            }

            const formattedLeagues = await Promise.all(userLeagues.map(async link => {
                const sleeperId = link.leagues.sleeper_league_id;
                const lData = await getLeagueData(sleeperId).catch(() => null);
                
                return {
                    id: link.league_id,
                    sleeper_league_id: sleeperId,
                    name: link.leagues.league_name,
                    is_commissioner: link.is_commissioner,
                    avatar: lData?.avatar ? `https://sleepercdn.com/avatars/thumbs/${lData.avatar}` : null
                };
            }));

            setUserLeaguesList(formattedLeagues);

            let activeLink = null;
            if (targetLeagueId) {
                activeLink = formattedLeagues.find(l => l.id === targetLeagueId);
            } else {
                const savedId = localStorage.getItem('activeLeagueId');
                activeLink = formattedLeagues.find(l => l.id === savedId) || formattedLeagues[0];
            }

            if (activeLink) {
                localStorage.setItem('activeLeagueId', activeLink.id);
                
                const { data: league, error: leagueError } = await supabase
                    .from('leagues')
                    .select('*')
                    .eq('id', activeLink.id)
                    .single();

                if (!leagueError) {
                    setActiveLeague({
                        ...league,
                        is_commissioner: activeLink.is_commissioner,
                        avatar: activeLink.avatar
                    });
                }
            }
        } catch (err) {
            console.error("Context initialization error:", err);
        } finally {
            setLoading(false);
        }
    };

    // A fast, dedicated switcher that utilizes pre-loaded state
    const switchActiveLeague = async (targetLeagueId) => {
        if (activeLeague?.id === targetLeagueId) return; // Prevent unnecessary fetches
        
        setLoading(true);
        try {
            const targetLeagueInfo = userLeaguesList.find(l => l.id === targetLeagueId);
            if (!targetLeagueInfo) return;

            localStorage.setItem('activeLeagueId', targetLeagueId);

            const { data: league, error: leagueError } = await supabase
                .from('leagues')
                .select('*')
                .eq('id', targetLeagueId)
                .single();

            if (!leagueError) {
                setActiveLeague({
                    ...league,
                    is_commissioner: targetLeagueInfo.is_commissioner,
                    avatar: targetLeagueInfo.avatar
                });
            }
        } catch (err) {
            console.error("Error switching leagues:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const init = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                loadLeagueContext(session.user.id);
            } else {
                setLoading(false);
            }
        };
        init();
    }, []);

    return (
        <LeagueContext.Provider value={{ activeLeague, userLeaguesList, loading, loadLeagueContext, switchActiveLeague }}>
            {children}
        </LeagueContext.Provider>
    );
};

export const useLeague = () => useContext(LeagueContext);