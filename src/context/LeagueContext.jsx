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

                // Fetch live Sleeper data for each league to guarantee we have the correct avatar hash
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
                    
                    // Prioritize the live Sleeper API avatar, then fallback to DB, then user avatar
                    const rawAvatar = sleeperAvatar || matchedLeague.avatar || matchedLeague.league_avatar || ul.avatar;
                    const formattedAvatar = formatAvatarUrl(rawAvatar);

                    return {
                        ...matchedLeague, 
                        ...ul,            
                        league_name: resolvedName,
                        name: resolvedName,
                        avatar: formattedAvatar, // Guaranteed full, clean image URL
                        league_avatar: formattedAvatar,
                        league_id: ul.league_id || matchedLeague.id,
                        sleeper_league_id: sleeperId
                    };
                }));

                setUserLeagues(flattenedLeagues); 
                setLeagueCount(flattenedLeagues.length);

                const targetId = leagueId || flattenedLeagues[0].league_id;
                const activeConnection = flattenedLeagues.find(ul => ul.league_id === targetId || ul.sleeper_league_id === targetId) || flattenedLeagues[0];

                if (activeConnection) {
                    setActiveLeague({
                        ...activeConnection, 
                        is_commissioner: activeConnection.is_commissioner, 
                        team_name: activeConnection.team_name,
                        avatar: activeConnection.avatar || '/brand.png'
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