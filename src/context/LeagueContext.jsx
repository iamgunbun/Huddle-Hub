import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const LeagueContext = createContext();

export function useLeague() {
    return useContext(LeagueContext);
}

export function LeagueProvider({ children }) {
    const [activeLeague, setActiveLeague] = useState(null);
    const [userLeagues, setUserLeagues] = useState([]); 
    const [loading, setLoading] = useState(true);
    
    // Premium & Limits State
    const [isPremium, setIsPremium] = useState(false);
    const [showPremiumModal, setShowPremiumModal] = useState(false);
    const [leagueCount, setLeagueCount] = useState(0);

    const loadLeagueContext = useCallback(async (userId, leagueId = null) => {
        if (!userId) {
            setActiveLeague(null);
            setUserLeagues([]);
            setIsPremium(false);
            setLeagueCount(0);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            try {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', userId)
                    .maybeSingle();
                    
                if (profile && 'is_premium' in profile) {
                    setIsPremium(profile.is_premium || false);
                } else {
                    setIsPremium(false);
                }
            } catch (e) {
                setIsPremium(false);
            }

            const { data: userLeaguesData, error: ulError } = await supabase
                .from('user_leagues')
                .select('*')
                .eq('user_id', userId);

            if (userLeaguesData && userLeaguesData.length > 0) {
                
                const leagueIds = userLeaguesData.map(ul => ul.league_id);
                
                const { data: leaguesData, error: leaguesError } = await supabase
                    .from('leagues')
                    .select('*')
                    .in('id', leagueIds);

                // NORMALIZED MAPPING: Guarantees every naming convention exists so the Sidebar can read it
                const flattenedLeagues = userLeaguesData.map(ul => {
    const matchedLeague = leaguesData?.find(l => l.id === ul.league_id || l.sleeper_league_id === ul.league_id) || {};
    const resolvedName = matchedLeague.league_name || matchedLeague.name || ul.team_name || "Unnamed League";
    
    return {
        ...matchedLeague, // Spread global league data first
        ...ul,            // Spread user data second
        league_name: resolvedName,
        name: resolvedName,
        avatar: ul.avatar || matchedLeague.avatar, // Explicitly preserve the avatar!
        league_id: ul.league_id || matchedLeague.id,
        sleeper_league_id: matchedLeague.sleeper_league_id || ul.league_id
    };
});

                setUserLeagues(flattenedLeagues); 
                setLeagueCount(flattenedLeagues.length);

                const targetId = leagueId || flattenedLeagues[0].league_id;
                const activeConnection = flattenedLeagues.find(ul => ul.league_id === targetId || ul.sleeper_league_id === targetId) || flattenedLeagues[0];

                if (activeConnection) {
                    setActiveLeague({
                        ...activeConnection, 
                        is_commissioner: activeConnection.is_commissioner, 
                        team_name: activeConnection.team_name
                    });
                }
            } else {
                setUserLeagues([]);
                setLeagueCount(0);
                setActiveLeague(null);
            }
        } catch (err) {
            console.error("Context Load Error:", err);
            setActiveLeague(null);
        } finally {
            setLoading(false);
        }
    }, []);

    const switchActiveLeague = async (leagueId) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                await loadLeagueContext(session.user.id, leagueId);
            }
        } catch (err) {
            console.error("Switch League Error:", err);
        }
    };

    useEffect(() => {
        let isMounted = true;

        const initAuth = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (isMounted) {
                    if (session?.user) {
                        await loadLeagueContext(session.user.id);
                    } else {
                        setLoading(false);
                    }
                }
            } catch (err) {
                console.error("Auth Init Error:", err);
                if (isMounted) setLoading(false);
            }
        };

        initAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (isMounted) {
                if (session?.user) {
                    loadLeagueContext(session.user.id);
                } else {
                    setActiveLeague(null);
                    setUserLeagues([]);
                    setIsPremium(false);
                    setLeagueCount(0);
                    setLoading(false);
                }
            }
        });

        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, [loadLeagueContext]);

    return (
        <LeagueContext.Provider value={{ 
            activeLeague, 
            userLeagues, 
            loading, 
            loadLeagueContext, 
            switchActiveLeague, 
            isPremium, 
            setIsPremium,
            showPremiumModal, 
            setShowPremiumModal, 
            leagueCount,
            setLeagueCount 
        }}>
            {children}
        </LeagueContext.Provider>
    );
}