import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { fetchAndNormalizeESPNLeague } from '../utils/espnService';
import { fetchAndNormalizeYahooLeague, fetchYahooOwnTeams } from '../utils/yahooService';
import { findSleeperLeagueUser, isSleeperCommissioner } from '../utils/leagueMembership';

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

// Brings stored commissioner status back in line with what the platform says.
//
// Connections made before this was captured have it stored as false regardless
// of the truth, which silently hides the commissioner tools. Only rows that
// actually disagree are written, so the common case costs reads and no writes.
const applyCommissionerFlag = async (userId, league, shouldBeCommissioner, selected, setActiveLeague) => {
    if (!!league.is_commissioner === shouldBeCommissioner) return;

    const { error } = await supabase
        .from('user_leagues')
        .update({ is_commissioner: shouldBeCommissioner })
        .eq('user_id', userId)
        .eq('league_id', league.id);

    if (error) {
        console.warn("Couldn't update commissioner status for", league.name, error);
        return;
    }

    if (selected && league.id === selected.id) {
        setActiveLeague(prev => (prev ? { ...prev, is_commissioner: shouldBeCommissioner } : prev));
    }
};

// Yahoo answers for every league at once: one request returns the account's own
// team in each, flagged. That's an exact, authoritative read, so it corrects in
// both directions.
const syncYahooCommissionerFlags = async (userId, leagues, selected, setActiveLeague) => {
    const yahooLeagues = (leagues || []).filter(l => l?.platform === 'yahoo' && l.sleeper_league_id);
    if (!yahooLeagues.length) return;

    const ownTeams = await fetchYahooOwnTeams(userId);
    if (!Object.keys(ownTeams).length) return;

    for (const league of yahooLeagues) {
        const ownTeam = ownTeams[String(league.sleeper_league_id)];
        // No entry means Yahoo didn't report a team for this account in that
        // league this season -- not evidence either way, so leave it alone.
        if (!ownTeam) continue;
        await applyCommissionerFlag(userId, league, !!ownTeam.isCommissioner, selected, setActiveLeague);
    }
};

// Sleeper needs a request per league and returns every member identically, so
// only the league actually in view is reconciled -- that's the one whose tools
// matter right now, and it keeps app load to a single extra request.
//
// Identification here is by stored team name, which is a heuristic: two members
// can share a display name, and a member can rename their team. So this only
// GRANTS commissioner status, never revokes it. Taking someone's access away on
// the strength of a name match would be the worse error, and a connection made
// from now on records the flag exactly, from the account's own Sleeper user id.
const syncSleeperCommissionerFlag = async (userId, selected, setActiveLeague) => {
    if (!selected || selected.platform !== 'sleeper' || !selected.sleeper_league_id) return;
    if (selected.is_commissioner) return;

    const res = await fetch(`https://api.sleeper.app/v1/league/${selected.sleeper_league_id}/users`);
    if (!res.ok) return;

    const me = findSleeperLeagueUser(await res.json(), { teamName: selected.team_name });
    if (!isSleeperCommissioner(me)) return;

    await applyCommissionerFlag(userId, selected, true, selected, setActiveLeague);
};

const syncCommissionerFlags = async (userId, leagues, selected, setActiveLeague) => {
    if (!userId) return;
    try {
        await Promise.all([
            syncYahooCommissionerFlags(userId, leagues, selected, setActiveLeague),
            syncSleeperCommissionerFlag(userId, selected, setActiveLeague),
        ]);
    } catch (err) {
        console.warn("Couldn't reconcile commissioner status:", err);
    }
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
                    
                    // Database Primary Key UUID (e.g. c632e497-...)
                    const dbRecordId = matchedLeague.id || ul.league_id;
                    
                    // External Provider ID (e.g. "470.l.604026" or Sleeper numeric ID)
                    const externalPlatformId = matchedLeague.sleeper_league_id || (ul.league_id !== dbRecordId ? ul.league_id : null);
                    
                    const isESPN = ul.platform === 'espn' || matchedLeague.platform === 'espn';
                    const isYahoo = ul.platform === 'yahoo' || matchedLeague.platform === 'yahoo';

                    let liveData = {};

                    if (isYahoo) {
                        try {
                            const yahooData = await fetchAndNormalizeYahooLeague(externalPlatformId || dbRecordId, userId);
                            if (yahooData) {
                                liveData = {
                                    avatar: yahooData.avatar,
                                    name: yahooData.name,
                                    total_rosters: yahooData.total_rosters,
                                    settings: yahooData.settings,
                                    season: yahooData.season
                                };
                            }
                        } catch (e) {
                            console.warn("Failed to fetch live Yahoo league data for", externalPlatformId);
                        }
                    } else if (isESPN) {
                        try {
                            const espnData = await fetchAndNormalizeESPNLeague(externalPlatformId || dbRecordId);
                            if (espnData) {
                                liveData = {
                                    avatar: espnData.avatar,
                                    name: espnData.name,
                                    total_rosters: espnData.total_rosters,
                                    settings: espnData.settings
                                };
                            }
                        } catch (e) {
                            console.warn("Failed to fetch live ESPN league data for", externalPlatformId);
                        }
                    } else {
                        const sleeperId = externalPlatformId || dbRecordId;
                        if (sleeperId && /^\d+$/.test(String(sleeperId))) {
                            try {
                                const res = await fetch(`https://api.sleeper.app/v1/league/${sleeperId}`);
                                if (res.ok) {
                                    const sData = await res.json();
                                    liveData = {
                                        avatar: sData.avatar,
                                        name: sData.name,
                                        total_rosters: sData.total_rosters,
                                        settings: sData.settings,
                                        season: sData.season
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
                        id: dbRecordId,                        // Preserves database UUID for Supabase queries
                        league_id: dbRecordId,                 // Preserves database foreign key
                        sleeper_league_id: externalPlatformId, // Preserves external API key (e.g. 470.l.604026)
                        league_name: resolvedName,
                        name: resolvedName,
                        avatar: finalAvatar,
                        league_avatar: finalAvatar,
                        platform: isYahoo ? 'yahoo' : (isESPN ? 'espn' : 'sleeper')
                    };
                }));

                setUserLeagues(flattenedLeagues); 
                setLeagueCount(flattenedLeagues.length);

                const savedLeagueId = localStorage.getItem('huddle_active_league_id');
                const targetIdToLoad = preferredLeagueId || savedLeagueId || flattenedLeagues[0].id;

                const activeConnection = flattenedLeagues.find(
                    ul => ul.id === targetIdToLoad || ul.league_id === targetIdToLoad || ul.sleeper_league_id === targetIdToLoad
                ) || flattenedLeagues[0];

                if (activeConnection) {
                    const selected = {
                        ...activeConnection, 
                        is_commissioner: activeConnection.is_commissioner, 
                        team_name: activeConnection.team_name,
                        avatar: activeConnection.avatar || '/brand.png'
                    };
                    setActiveLeague(selected);
                    localStorage.setItem('huddle_active_league_id', selected.id);

                    // Connections made before commissioner status was captured
                    // have it stored as false regardless of the truth. Both
                    // platforms can say who runs the league, so ask and correct
                    // the record.
                    syncCommissionerFlags(userId, flattenedLeagues, selected, setActiveLeague);
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
                l => l.id === leagueId || l.league_id === leagueId || l.sleeper_league_id === leagueId
            );

            if (target) {
                const updated = {
                    ...target,
                    is_commissioner: target.is_commissioner,
                    team_name: target.team_name,
                    avatar: target.avatar || '/brand.png'
                };
                setActiveLeague(updated);
                localStorage.setItem('huddle_active_league_id', target.id);
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