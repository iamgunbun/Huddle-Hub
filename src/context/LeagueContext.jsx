import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { fetchAndNormalizeESPNLeague } from '../utils/espnService';
import { fetchAndNormalizeYahooLeague } from '../utils/yahooService';

const LeagueContext = createContext();

export function useLeague() {
    return useContext(LeagueContext);
}

const formatAvatarUrl = (avatar) => {
    if (!avatar || typeof avatar !== 'string' || avatar.trim() === '' || avatar === 'null') {
        return '/brand.png';
    }
    
    if (avatar.startsWith('http') || avatar.startsWith('/')) {
        return avatar;
    }
    
    return `https://sleepercdn.com/avatars/thumbs/${avatar}`;
};

export function LeagueProvider({ children }) {
    const [activeLeague, setActiveLeague] = useState(null);
    const [userLeagues, setUserLeagues] = useState([]); 
    const [loading, setLoading] = useState(true);
    
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

            const { data: userLeaguesData } = await supabase
                .from('user_leagues')
                .select('*')
                .eq('user_id', userId);

            if (userLeaguesData && userLeaguesData.length > 0) {
                const leagueIds = userLeaguesData.map(ul => ul.league_id);
                
                const { data: leaguesData } = await supabase
                    .from('leagues')
                    .select('*')
                    .in('id', leagueIds);

                const flattenedLeagues = await Promise.all(userLeaguesData.map(async (ul) => {
                    const matchedLeague = leaguesData?.find(l => l.id === ul.league_id || l.sleeper_league_id === ul.league_id) || {};
                    
                    // FIX: Prioritize the external API key (sleeper_league_id) over the Supabase UUID
                    const targetId = matchedLeague.sleeper_league_id || ul.league_id || matchedLeague.id;
                    
                    const isESPN = ul.platform === 'espn' || matchedLeague.platform === 'espn';
                    const isYahoo = ul.platform === 'yahoo' || matchedLeague.platform === 'yahoo';

                    let liveData = {};

                    if (isYahoo) {
                        try {
                            const yahooData = await fetchAndNormalizeYahooLeague(targetId, userId);
                            if (yahooData) {
                                liveData = {
                                    sleeper_league_id: yahooData.sleeper_league_id || targetId,
                                    avatar: yahooData.avatar,
                                    name: yahooData.name,
                                    total_rosters: yahooData.total_rosters,
                                    settings: yahooData.settings
                                };
                            }
                        } catch (e) {
                            console.warn("Failed to fetch live Yahoo league data for", targetId);
                        }
                    } else if (isESPN) {
                        try {
                            const espnData = await fetchAndNormalizeESPNLeague(targetId);
                            if (espnData) {
                                liveData = {
                                    sleeper_league_id: espnData.sleeper_league_id || targetId,
                                    avatar: espnData.avatar,
                                    name: espnData.name,
                                    total_rosters: espnData.total_rosters,
                                    settings: espnData.settings
                                };
                            }
                        } catch (e) {
                            console.warn("Failed to fetch live ESPN league data for", targetId);
                        }
                    } else {
                        const sleeperId = matchedLeague.sleeper_league_id || targetId;
                        if (sleeperId) {
                            try {
                                const res = await fetch(`https://api.sleeper.app/v1/league/${sleeperId}`);
                                if (res.ok) {
                                    const sData = await res.json();
                                    liveData = {
                                        sleeper_league_id: sleeperId,
                                        avatar: sData.avatar,
                                        name: sData.name,
                                        total_rosters: sData.total_rosters,
                                        settings: sData.settings
                                    };
                                }
                            } catch (e) {
                                console.warn("Failed to fetch live Sleeper data for", sleeperId);
                            }
                        }
                    }

                    const resolvedName = liveData.name || matchedLeague.league_name || matchedLeague.name || ul.team_name || "Unnamed League";
                    const rawAvatar = liveData.avatar || matchedLeague.avatar || matchedLeague.league_avatar || ul.avatar;
                    const finalAvatar = (isESPN || isYahoo) ? (rawAvatar || '/brand.png') : formatAvatarUrl(rawAvatar);

                    return {
                        ...matchedLeague, 
                        ...ul,
                        ...liveData,            
                        league_name: resolvedName,
                        name: resolvedName,
                        avatar: finalAvatar,
                        league_avatar: finalAvatar,
                        league_id: targetId,
                        platform: isYahoo ? 'yahoo' : (isESPN ? 'espn' : 'sleeper')
                    };
                }));

                setUserLeagues(flattenedLeagues); 
                setLeagueCount(flattenedLeagues.length);

                const savedLeagueId = localStorage.getItem('huddle_active_league_id');
                const targetIdToLoad = preferredLeagueId || savedLeagueId || flattenedLeagues[0].league_id;

                const activeConnection = flattenedLeagues.find(
                    ul => ul.league_id === targetIdToLoad || ul.sleeper_league_id === targetIdToLoad || ul.id === targetIdToLoad
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

    const switchActiveLeague = async (leagueId) => {
        if (!leagueId) return;

        try {
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