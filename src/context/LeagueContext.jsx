import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const LeagueContext = createContext();

export function useLeague() {
    return useContext(LeagueContext);
}

// Helper to securely format the Sleeper avatar without double-encoding it
const formatAvatarUrl = (avatar) => {
    if (!avatar || typeof avatar !== 'string' || avatar.trim() === '' || avatar === 'null') {
        return '/brand.png';
    }
    
    // If it's already a fully qualified URL, return it directly
    if (avatar.startsWith('http') || avatar.startsWith('/')) {
        return avatar;
    }
    
    // Otherwise, append the Sleeper CDN
    return `https://sleepercdn.com/avatars/thumbs/${avatar}`;
};

export function LeagueProvider({ children }) {
    const [activeLeague, setActiveLeague] = useState(null);
    const [userLeagues, setUserLeagues] = useState([]); 
    const [loading, setLoading] = useState(true);
    
    // Premium & Limits State
    const [isPremium, setIsPremium] = useState(false);
    const [showPremiumModal, setShowPremiumModal] = useState(false);
    const [leagueCount, setLeagueCount] = useState(0);

    const loadLeagueContext = useCallback(async (userId, preferredLeagueId = null) => {
        if (!userId) {
            setActiveLeague(null);
            setUserLeagues([]);
            setIsPremium(false);
            setLeagueCount(0);
            setLoading(false);
            return;
        }

        try {
            // 1. Fetch Profile for Premium Status
            try {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('is_premium')
                    .eq('id', userId)
                    .maybeSingle();
                    
                setIsPremium(profile?.is_premium || false);
            } catch (e) {
                setIsPremium(false);
            }

            // 2. Fetch User Leagues Mapping
            const { data: userLeaguesData, error: ulError } = await supabase
                .from('user_leagues')
                .select('*')
                .eq('user_id', userId);

            if (userLeaguesData && userLeaguesData.length > 0) {
                const leagueIds = userLeaguesData.map(ul => ul.league_id);
                
                const { data: leaguesData } = await supabase
                    .from('leagues')
                    .select('*')
                    .in('id', leagueIds);

                // 3. Build the flattened league objects
                const flattenedLeagues = await Promise.all(userLeaguesData.map(async (ul) => {
                    const matchedLeague = leaguesData?.find(l => l.id === ul.league_id || l.sleeper_league_id === ul.league_id) || {};
                    const sleeperId = matchedLeague.sleeper_league_id || ul.league_id;
                    
                    let sleeperAvatar = null;
                    let sleeperName = null;

                    if (sleeperId) {
                        try {
                            const res = await fetch(`https://api.sleeper.app/v1/league/${sleeperId}`);
                            if (res.ok) {
                                const sData = await res.json();
                                sleeperAvatar = sData.avatar;
                                sleeperName = sData.name;
                            }
                        } catch (e) {
                            console.warn("Failed to fetch live sleeper data for", sleeperId);
                        }
                    }

                    const resolvedName = sleeperName || matchedLeague.league_name || matchedLeague.name || ul.team_name || "Unnamed League";
                    const rawAvatar = sleeperAvatar || matchedLeague.avatar || matchedLeague.league_avatar || ul.avatar;
                    const formattedAvatar = formatAvatarUrl(rawAvatar);

                    return {
                        ...matchedLeague, 
                        ...ul,            
                        league_name: resolvedName,
                        name: resolvedName,
                        avatar: formattedAvatar,
                        league_avatar: formattedAvatar,
                        league_id: ul.league_id || matchedLeague.id,
                        sleeper_league_id: sleeperId
                    };
                }));

                setUserLeagues(flattenedLeagues); 
                setLeagueCount(flattenedLeagues.length);

                // 4. Determine Active League (Check parameter -> localStorage -> First League)
                const savedLeagueId = localStorage.getItem('huddle_active_league_id');
                const targetId = preferredLeagueId || savedLeagueId || flattenedLeagues[0].league_id;

                const activeConnection = flattenedLeagues.find(
                    ul => ul.league_id === targetId || ul.sleeper_league_id === targetId || ul.id === targetId
                ) || flattenedLeagues[0];

                if (activeConnection) {
                    const selected = {
                        ...activeConnection, 
                        is_commissioner: activeConnection.is_commissioner, 
                        team_name: activeConnection.team_name,
                        avatar: activeConnection.avatar || '/brand.png'
                    };
                    setActiveLeague(selected);
                    localStorage.setItem('huddle_active_league_id', selected.league_id || selected.id);
                }
            } else {
                setUserLeagues([]);
                setLeagueCount(0);
                setActiveLeague(null);
                localStorage.removeItem('huddle_active_league_id');
            }
        } catch (err) {
            console.error("Context Load Error:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    // FAST IN-MEMORY SWITCH: Zero delay, no re-fetching all leagues from Sleeper
    const switchActiveLeague = async (leagueId) => {
        if (!leagueId) return;

        try {
            // Find in current memory cache
            const target = userLeagues.find(
                l => l.league_id === leagueId || l.sleeper_league_id === leagueId || l.id === leagueId
            );

            if (target) {
                const updated = {
                    ...target,
                    is_commissioner: target.is_commissioner,
                    team_name: target.team_name,
                    avatar: target.avatar || '/brand.png'
                };
                setActiveLeague(updated);
                localStorage.setItem('huddle_active_league_id', target.league_id || target.id);
                return;
            }

            // Fallback if userLeagues wasn't populated yet
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
                        const savedId = localStorage.getItem('huddle_active_league_id');
                        await loadLeagueContext(session.user.id, savedId);
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

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!isMounted) return;

            if (event === 'SIGNED_OUT' || !session?.user) {
                setActiveLeague(null);
                setUserLeagues([]);
                setIsPremium(false);
                setLeagueCount(0);
                setLoading(false);
                localStorage.removeItem('huddle_active_league_id');
            } else if (event === 'SIGNED_IN') {
                const savedId = localStorage.getItem('huddle_active_league_id');
                loadLeagueContext(session.user.id, savedId);
            }
            // Background token refreshes ('TOKEN_REFRESHED') will no longer wipe your league state!
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