import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const LeagueContext = createContext();

export const useLeague = () => useContext(LeagueContext);

export const LeagueProvider = ({ children }) => {
    const [activeLeague, setActiveLeague] = useState(null);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState(null);

    // This function fetches the user's leagues and sets the active one
    const loadLeagueContext = async (uid, specificLeagueId = null) => {
        setLoading(true);
        try {
            let query = supabase
                .from('user_leagues')
                .select('league_id, is_commissioner, team_name, leagues(*)')
                .eq('user_id', uid);

            // If a specific league ID is passed (like right after adding a new league), prioritize it
            if (specificLeagueId) {
                query = query.eq('league_id', specificLeagueId);
            }

            const { data, error } = await query;

            if (error) throw error;

            if (data && data.length > 0) {
                // If they have multiple leagues, default to the first one returned
                const selected = data[0];
                setActiveLeague({
                    ...selected.leagues,
                    is_commissioner: selected.is_commissioner,
                    my_team_name: selected.team_name
                });
            } else {
                setActiveLeague(null);
            }
        } catch (err) {
            console.error("Error loading league context:", err);
            setActiveLeague(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // 1. Initial check when the app first loads
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUserId(session.user.id);
                loadLeagueContext(session.user.id);
            } else {
                setLoading(false);
            }
        });

        // 2. THE FIX: The active listener. 
        // This fires instantly when the user finishes logging in or logging out.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session?.user) {
                // Instantly grab data without needing a page refresh
                setUserId(session.user.id);
                loadLeagueContext(session.user.id);
            } else if (event === 'SIGNED_OUT') {
                // Clear the data completely if they log out
                setUserId(null);
                setActiveLeague(null);
                setLoading(false);
            }
        });

        // Cleanup listener when app closes
        return () => {
            if (subscription) subscription.unsubscribe();
        };
    }, []);

    return (
        <LeagueContext.Provider value={{ activeLeague, setActiveLeague, loading, loadLeagueContext }}>
            {children}
        </LeagueContext.Provider>
    );
};