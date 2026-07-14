import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueMatchups, getLeagueTeamManagers, getBrackets, loadPlayers, getLeagueData } from '../utils/helper';
import styles from './Matchups.module.css';
import Matchup from '../components/Matchups/Matchup';
import MatchupsAndBrackets from '../components/Matchups/MatchupsAndBrackets';

export default function Matchups() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [matchupsData, setMatchupsData] = useState(null);
    const [leagueTeamManagersData, setLeagueTeamManagersData] = useState(null);
    const [bracketsData, setBracketsData] = useState(null);
    const [playersInfo, setPlayersInfo] = useState(null);
    const [leagueData, setLeagueData] = useState(null);
    const [viewMode, setViewMode] = useState('mine');
    const [myRosterId, setMyRosterId] = useState(null);
    const [selectingTeam, setSelectingTeam] = useState(false);

    // Strips all casing, spaces, and special characters for a perfect comparison
    const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const sleeperId = activeLeague.sleeper_league_id;
                const [m, tm, b, p, ld] = await Promise.all([
                    getLeagueMatchups(sleeperId),
                    getLeagueTeamManagers(sleeperId),
                    getBrackets(sleeperId).catch(() => null),
                    loadPlayers(),
                    getLeagueData(sleeperId)
                ]);

                if (!isMounted) return;
                setMatchupsData(m);
                setLeagueTeamManagersData(tm);
                setBracketsData(b);
                setPlayersInfo(p);
                setLeagueData(ld);

                const { data: sessionData } = await supabase.auth.getSession();
                const user = sessionData?.session?.user;

                if (user && activeLeague?.id) {
                    const { data: ulData } = await supabase
                        .from('user_leagues')
                        .select('team_name')
                        .eq('user_id', user.id)
                        .eq('league_id', activeLeague.id)
                        .single();

                    const searchName = normalizeStr(ulData?.team_name);
                    
                    if (searchName && searchName !== normalizeStr('commissioner team')) {
                        const currentSeason = tm.currentSeason;
                        const rostersMap = tm.teamManagersMap[currentSeason] || {};
                        let foundRosterId = null;

                        for (const [rId, rData] of Object.entries(rostersMap)) {
                            if (normalizeStr(rData.team?.name) === searchName) {
                                foundRosterId = rId;
                                break;
                            }
                        }

                        if (foundRosterId) setMyRosterId(foundRosterId);
                    }
                }
            } catch (e) {
                console.error("Matchups fetch error:", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        loadData();
        return () => { isMounted = false; };
    }, [activeLeague]);

    const handleSetMyTeam = async (e) => {
        const id = e.target.value;
        if (!id) return;
        setMyRosterId(id);
        const selectedTeamName = leagueTeamManagersData.teamManagersMap[leagueTeamManagersData.currentSeason][id].team.name;
        
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
            await supabase.from('user_leagues')
                .update({ team_name: selectedTeamName })
                .eq('user_id', sessionData.session.user.id)
                .eq('league_id', activeLeague.id);
        }
        setSelectingTeam(false);
    };

    const myMatchup = useMemo(() => {
        if (!matchupsData || !myRosterId) return null;
        const currentWeekData = matchupsData.matchupWeeks?.find(w => w.week === matchupsData.week);
        if (!currentWeekData) return null;
        
        for (const key in currentWeekData.matchups) {
            const matchArr = currentWeekData.matchups[key];
            if (matchArr.find(team => team.roster_id == myRosterId)) {
                if (matchArr[0].roster_id == myRosterId) return matchArr;
                return [matchArr[1], matchArr[0]]; 
            }
        }
        return null;
    }, [matchupsData, myRosterId]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', flexDirection: 'column' }}>
                <div style={{ color: '#eebf1c', fontSize: '1.2em', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '2px' }}>
                    Loading Matchups...
                </div>
            </div>
        );
    }

    if (!matchupsData?.matchupWeeks?.length || !leagueTeamManagersData || !playersInfo || !leagueData) {
        return (
            <div style={{ textAlign: 'center', marginTop: '100px', color: '#94a3b8' }}>
                <h3 style={{ color: '#f8fafc' }}>No Matchups Available</h3>
                <p>Sleeper has not generated schedule data for this league year yet.</p>
            </div>
        );
    }

    return (
        <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
            <div className={styles.viewToggles}>
                <button className={`${styles.toggleBtn} ${viewMode === 'mine' ? styles.active : ''}`} onClick={() => setViewMode('mine')}>
                    My Matchup
                </button>
                <button className={`${styles.toggleBtn} ${viewMode === 'all' ? styles.active : ''}`} onClick={() => setViewMode('all')}>
                    All Matchups
                </button>
            </div>

            {viewMode === 'mine' ? (
                (!myRosterId || selectingTeam) ? (
                    <div className={styles.claimBox}>
                        <h3 style={{ color: '#f8fafc', marginTop: 0 }}>Which team is yours?</h3>
                        <p style={{ color: '#94a3b8', fontSize: '0.9em' }}>Select your team to track your live matchup.</p>
                        <select onChange={handleSetMyTeam} defaultValue="">
                            <option value="" disabled>-- Select Your Team --</option>
                            {Object.entries(leagueTeamManagersData.teamManagersMap[leagueTeamManagersData.currentSeason] || {}).map(([rId, rData]) => (
                                <option key={rId} value={rId}>{rData.team.name}</option>
                            ))}
                        </select>
                    </div>
                ) : myMatchup ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
                            <button 
                                style={{ background: 'transparent', border: 'none', color: '#64748b', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.85em' }} 
                                onClick={() => setSelectingTeam(true)}
                            >
                                Wrong Team? Change it here.
                            </button>
                        </div>
                        <h2 style={{ textAlign: 'center', color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            Week {matchupsData.week}
                        </h2>
                        <Matchup 
                            matchup={myMatchup} 
                            players={playersInfo.players} 
                            leagueTeamManagers={leagueTeamManagersData} 
                            year={matchupsData.year} 
                            week={matchupsData.week} 
                            leagueData={leagueData} 
                        />
                    </>
                ) : (
                    <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '40px' }}>
                        No matchup data found for your team this week.
                    </div>
                )
            ) : (
                <MatchupsAndBrackets 
                    matchupsData={matchupsData} 
                    leagueTeamManagers={leagueTeamManagersData} 
                    bracketsData={bracketsData} 
                    playersInfo={playersInfo} 
                    leagueData={leagueData} 
                />
            )}
        </div>
    );
}