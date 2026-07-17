import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const LeagueContext = createContext();

export const useLeague = () => useContext(LeagueContext);

export const LeagueProvider = ({ children }) => {
    const [activeLeague, setActiveLeague] = useState(null);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState(null);

    const loadLeagueContext = async (uid, specificLeagueId = null) => {
        setLoading(true);
        try {
            let query = supabase
                .from('user_leagues')
                .select('league_id, is_commissioner, team_name, leagues(*)')
                .eq('user_id', uid);

            if (specificLeagueId) query = query.eq('league_id', specificLeagueId);

            const { data, error } = await query;
            if (error) throw error;

            if (data && data.length > 0) {
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
        let mounted = true;

        // Initial check on mount
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUserId(session.user.id);
                loadLeagueContext(session.user.id);
            } else {
                if (mounted) setLoading(false);
            }
        });

        // Active listener to catch manual log-outs
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                setUserId(null);
                setActiveLeague(null);
                setLoading(false);
            } else if (event === 'SIGNED_IN' && session?.user) {
                setUserId(session.user.id);
            }
        });

        return () => {
            mounted = false;
            if (subscription) subscription.unsubscribe();
        };
    }, []);

    return (
        <LeagueContext.Provider value={{ activeLeague, setActiveLeague, loading, loadLeagueContext }}>
            {children}
        </LeagueContext.Provider>
    );
};