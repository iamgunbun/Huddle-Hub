import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueRosters, getLeagueTeamManagers, loadPlayers, getLeagueData, getLeagueStandings, getNflState } from '../utils/helper';
import { getTeamFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import { resolvePlayerFromMeta, entryOwnsLookupId } from '../utils/playerPool';
import { scoreStatLine } from '../utils/yahooScoring';
import { fetchAndNormalizeYahooMatchups } from '../utils/yahooService';
import { fetchAndNormalizeESPNMatchups, fetchAndNormalizeESPNRosters } from '../utils/espnService';
import { isViewingLiveWeek, LIVE_SCORE_POLL_MS } from '../utils/liveScores';
import { isYahooLeagueId, isEspnLeagueId, isForeignPlatformLeague, sleeperFeedKey } from '../utils/platformIds';
import { resolveImageSrc, onImageError } from '../utils/imageFallback';
import { getPlatformLink } from '../utils/platformLinks';
import { getPlayerInjuryInfo } from '../utils/injuryStatus';
import PlayerModal from '../components/PlayerModal';
import styles from './Rosters.module.css';

export default function Rosters() {
    const { activeLeague } = useLeague();
    // Same link Sidebar.jsx's "Go to <platform>" already uses -- on every
    // platform this lands on the connected account's own team page, which is
    // where lineup editing actually lives (none of the three has a separate
    // "edit lineup" URL apart from the team page itself).
    const platformLink = getPlatformLink(activeLeague);
    // On Yahoo/ESPN the dictionary is keyed by that platform's player ids, which
    // must never be used against Sleeper's own stat feeds (see sleeperFeedKey).
    const foreignPlatform = isForeignPlatformLeague(activeLeague?.sleeper_league_id);
    const [loading, setLoading] = useState(true);
    const [rosters, setRosters] = useState({});
    const [teamManagers, setTeamManagers] = useState(null);
    const [playersInfo, setPlayersInfo] = useState({});
    const [playersByName, setPlayersByName] = useState({});
    const [yahooPlayersMeta, setYahooPlayersMeta] = useState({});
    const [leagueData, setLeagueData] = useState(null);
    const [standings, setStandings] = useState(null);
    const [viewMode, setViewMode] = useState('mine');
    const [myRosterId, setMyRosterId] = useState(null);
    
    const [expandedBenches, setExpandedBenches] = useState({});
    const [expandedTeams, setExpandedTeams] = useState({});
    
    const [activeWeek, setActiveWeek] = useState(1);
    const [weeklyMatchups, setWeeklyMatchups] = useState([]);
    const [weeklyProjections, setWeeklyProjections] = useState({});
    const [weeklyStats, setWeeklyStats] = useState({});
    const [nflScheduleMap, setNflScheduleMap] = useState({});
    // The real current NFL week -- used both to land on the right week by
    // default and to decide whether the viewed week is worth polling live.
    const [nflState, setNflState] = useState(null);

    const [selectedPlayer, setSelectedPlayer] = useState(null);

    const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const normalizeTeam = (t) => {
        if (!t) return '';
        const map = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR', NOH: 'NO' };
        const upper = String(t).toUpperCase();
        return map[upper] || upper;
    };

    const getPlayerObj = (pId) => {
        if (!pId || pId === "0") return null;

        const direct = playersInfo[pId] || playersInfo[String(pId)] || playersInfo[Number(pId)];
        const yahooMeta = yahooPlayersMeta[String(pId)];
        // ESPN's own pre-computed points (already scored under the league's
        // real rules) beat rebuilding them from Sleeper's generic feed --
        // carried over regardless of which path below resolves the rest of
        // the player's identity, since only yahooMeta (this platform's own
        // roster metadata) ever carries these.
        const espnPoints = yahooMeta ? { actualPoints: yahooMeta.actualPoints, projectedPoints: yahooMeta.projectedPoints } : null;

        // A direct hit is only this player if the entry owns the id space it
        // sits in. On ESPN/Yahoo the dictionary falls back to a Sleeper id for
        // anyone the crosswalk misses, so a real platform id can otherwise
        // land on an unrelated player with the same number -- see
        // entryOwnsLookupId.
        if (direct && entryOwnsLookupId(direct)) return espnPoints ? { ...direct, ...espnPoints } : direct;
        if (!yahooMeta) return null;

        // Yahoo gave us this player but Sleeper's yahoo_id crosswalk didn't map
        // them. Recover the full record (projections, stats, sleeper_id) via team
        // abbreviation for defenses -- Sleeper keys those by team and gives them
        // no yahoo_id -- and by name, suffix-tolerantly, for everyone else.
        const matched = resolvePlayerFromMeta(yahooMeta, playersInfo, playersByName);
        if (matched) return { ...matched, headshot: yahooMeta.headshot || null, ...espnPoints };

        return yahooMeta;
    };

    // 1. Initial Load
    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const [rData, tmData, pData, lData, sData, nState] = await Promise.all([
                    getLeagueRosters(activeLeague.sleeper_league_id),
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    loadPlayers(activeLeague.sleeper_league_id),
                    getLeagueData(activeLeague.sleeper_league_id),
                    getLeagueStandings(activeLeague.sleeper_league_id),
                    getNflState().catch(() => null)
                ]);
                if (!isMounted) return;

                setRosters(rData.rosters || {});
                setYahooPlayersMeta(rData.yahooPlayersMeta || {});
                setTeamManagers(tmData);
                setPlayersInfo(pData.players || {});
                setPlayersByName(pData.playersByName || {});
                setLeagueData(lData);
                setStandings(sData?.standingsInfo || {});
                setNflState(nState);

                // `leagueData` (Sleeper or Yahoo) carries no "current week" field
                // of its own -- the real NFL state is the one source both
                // platforms can be landed on correctly by.
                if (nState?.season_type === 'regular') setActiveWeek(nState.display_week || nState.week || 1);
                else if (nState?.season_type === 'post') setActiveWeek(18);

                if (isYahooLeagueId(activeLeague.sleeper_league_id) || isEspnLeagueId(activeLeague.sleeper_league_id)) {
                    // Yahoo flags the requesting user's own team directly, and
                    // ESPN's roster fetch resolves the same flag from the
                    // connecting account's SWID -- both reliable regardless of
                    // what (if anything) got stored as the connection's
                    // team_name, unlike the string-matching path below.
                    const ownedRoster = Object.values(rData.rosters || {}).find(r => r.is_owned_by_current_login);
                    if (ownedRoster) setMyRosterId(ownedRoster.roster_id);
                    else setViewMode('all');
                } else {
                    const { data: sessionData } = await supabase.auth.getSession();
                    if (sessionData?.session?.user && activeLeague?.id) {
                        const { data: ulData } = await supabase.from('user_leagues').select('team_name').eq('user_id', sessionData.session.user.id).eq('league_id', activeLeague.id).single();
                        const searchName = normalizeStr(ulData?.team_name);

                        if (searchName && searchName !== normalizeStr('commissioner team')) {
                            const rostersMap = tmData.teamManagersMap[tmData.currentSeason] || {};
                            let foundRosterId = Object.keys(rostersMap).find(rId => normalizeStr(rostersMap[rId].team?.name) === searchName);
                            if (foundRosterId) setMyRosterId(foundRosterId);
                            else setViewMode('all');
                        } else setViewMode('all');
                    }
                }
            } catch (e) { console.error(e); } finally { if (isMounted) setLoading(false); }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    // 2. Weekly Projections and Matchups
    useEffect(() => {
        const season = leagueData?.season || new Date().getFullYear();
        if (!activeLeague?.sleeper_league_id) return;
        let isMounted = true;

        // Scores, live per-player points and box-score stats all move while a
        // game is being played, so this whole block is re-run on a timer below
        // rather than fetched once -- otherwise a roster's live points only
        // ever updated on a manual reload or a week change.
        const loadLiveData = () => {
            if (isYahooLeagueId(activeLeague.sleeper_league_id)) {
                fetchAndNormalizeYahooMatchups(activeLeague.sleeper_league_id, activeWeek)
                    .then(({ matchups }) => {
                        if (!isMounted) return;
                        const flat = [];
                        Object.entries(matchups || {}).forEach(([mId, pair]) => {
                            pair.forEach(team => flat.push({ ...team, matchup_id: mId }));
                        });
                        setWeeklyMatchups(flat);
                    })
                    .catch(err => console.error("Yahoo matchups fetch err:", err));
            } else if (isEspnLeagueId(activeLeague.sleeper_league_id)) {
                fetchAndNormalizeESPNMatchups(activeLeague.sleeper_league_id, activeWeek)
                    .then(({ matchups }) => {
                        if (!isMounted) return;
                        const flat = [];
                        Object.entries(matchups || {}).forEach(([mId, pair]) => {
                            pair.forEach(team => flat.push({ ...team, matchup_id: mId }));
                        });
                        setWeeklyMatchups(flat);
                    })
                    .catch(err => console.error("ESPN matchups fetch err:", err));

                // ESPN pre-computes each player's actual/projected points under
                // the league's own scoring rules -- that's more reliable than
                // rebuilding them from Sleeper's generic feed below, which has
                // little to no real defense coverage. Re-fetched with this
                // week's scoringPeriodId (the initial roster load has no week
                // yet, so it never gets these) and merged into the platform
                // metadata every other lookup already falls back to.
                fetchAndNormalizeESPNRosters(activeLeague.sleeper_league_id, { week: activeWeek })
                    .then(({ yahooPlayersMeta: weekMeta }) => {
                        if (!isMounted || !weekMeta) return;
                        setYahooPlayersMeta(prev => ({ ...prev, ...weekMeta }));
                    })
                    .catch(err => console.error("ESPN weekly player points fetch err:", err));
            } else {
                fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}/matchups/${activeWeek}`)
                    .then(res => res.json())
                    .then(data => { if (isMounted) setWeeklyMatchups(data || []); })
                    .catch(err => console.error("Matchups fetch err:", err));
            }

            fetch(`https://api.sleeper.com/projections/nfl/${season}/${activeWeek}?season_type=regular`)
                .then(res => res.json())
                .then(data => {
                    if (isMounted) {
                        if (Array.isArray(data)) {
                            const map = {};
                            data.forEach(item => { if (item.player_id) map[item.player_id] = item; });
                            setWeeklyProjections(map);
                        } else {
                            setWeeklyProjections(data || {});
                        }
                    }
                })
                .catch(err => console.error("Projections fetch err:", err));

            fetch(`https://api.sleeper.com/stats/nfl/${season}/${activeWeek}?season_type=regular`)
                .then(res => res.json())
                .then(data => {
                    if (isMounted) {
                        if (Array.isArray(data)) {
                            const map = {};
                            data.forEach(item => { if (item.player_id) map[item.player_id] = item; });
                            setWeeklyStats(map);
                        } else {
                            setWeeklyStats(data || {});
                        }
                    }
                })
                .catch(err => console.error("Stats fetch err:", err));

            // PERFECT FIX: ESPN Scoreboard for absolute Home/Away accuracy
            fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${activeWeek}&dates=${season}`)
                .then(res => res.json())
                .then(data => {
                    if (isMounted && data?.events) {
                        const map = {};
                        data.events.forEach(event => {
                            const comp = event.competitions?.[0];
                            if (comp && comp.competitors) {
                                const homeTeam = comp.competitors.find(c => c.homeAway === 'home')?.team?.abbreviation;
                                const awayTeam = comp.competitors.find(c => c.homeAway === 'away')?.team?.abbreviation;

                                if (homeTeam && awayTeam) {
                                    const home = normalizeTeam(homeTeam);
                                    const away = normalizeTeam(awayTeam);
                                    map[home] = `VS ${away}`;
                                    map[away] = `@ ${home}`;
                                }
                            }
                        });
                        setNflScheduleMap(map);
                    }
                })
                .catch(err => console.error("ESPN Schedule fetch err:", err));
        };

        loadLiveData();

        let intervalId = null;
        if (isViewingLiveWeek(nflState, activeWeek)) {
            intervalId = setInterval(() => {
                if (document.hidden) return;
                loadLiveData();
            }, LIVE_SCORE_POLL_MS);
        }

        return () => {
            isMounted = false;
            if (intervalId) clearInterval(intervalId);
        };
    }, [activeLeague, activeWeek, leagueData?.season, nflState]);

    const handleToggleView = () => {
        if (viewMode === 'mine') {
            setViewMode('all');
            setExpandedTeams({}); 
        } else {
            setViewMode('mine');
        }
    };

    const toggleBench = (rosterId) => {
        setExpandedBenches(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
    };

    const toggleTeamExpand = (rosterId) => {
        setExpandedTeams(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
    };

    const getPlayerLivePts = (pId, rosterId) => {
        if (!pId || pId === "0") return '0.00';
        const matchup = weeklyMatchups.find(m => m.roster_id === parseInt(rosterId));
        if (matchup?.players_points && matchup.players_points[pId] !== undefined) {
            return parseFloat(matchup.players_points[pId]).toFixed(2);
        }
        // ESPN's matchup feed only carries team totals, not a per-player
        // breakdown (players_points is always empty) -- its roster fetch is
        // the one place actual per-player points for the week come from.
        const actual = getPlayerObj(pId)?.actualPoints;
        if (Number.isFinite(actual)) return actual.toFixed(2);
        return '0.00';
    };

    const getPlayerProjPts = (playerId) => {
        const playerObj = getPlayerObj(playerId);

        // ESPN pre-computes this under the league's own scoring rules -- more
        // reliable than rebuilding it from Sleeper's generic feed below, which
        // has little to no real defense coverage (the actual bug report this
        // fixes: a DEF's projection reading 0 even mid-week).
        if (Number.isFinite(playerObj?.projectedPoints)) return playerObj.projectedPoints.toFixed(1);

        // Sleeper's projections/stats feeds are keyed by Sleeper player ids, and
        // a Yahoo/ESPN roster id looked up in them doesn't harmlessly miss -- the
        // id spaces overlap, so it returns an unrelated player's stat line. Only
        // the crosswalked sleeper_id may be used here (see sleeperFeedKey).
        const feedKey = sleeperFeedKey(playerObj, playerId, foreignPlatform);
        const proj = feedKey ? (weeklyProjections[feedKey] || weeklyStats[feedKey]) : null;
        const scoringSettings = leagueData?.scoring_settings || {};

        if (proj) {
            const stats = proj.stats || proj || {};
            // Score the projected stat line against the league's own rules
            // (handles defense points-allowed tiers and kicker FG distances,
            // and returns null -- not 0 -- when none of the league's scored
            // stats are present, so the fallbacks below can take over).
            const scored = scoreStatLine(stats, scoringSettings, playerObj?.pos);
            if (scored !== null) return scored.toFixed(1);

            const rec = scoringSettings.rec || 0;
            let key = 'pts_std';
            if (rec === 1) key = 'pts_ppr';
            else if (rec === 0.5) key = 'pts_half_ppr';
            
            const basePts = stats[key] || proj[key] || 0;
            if (basePts > 0) return parseFloat(basePts).toFixed(1);
        }

        const cachePts = playerObj?.wi?.[activeWeek]?.p ? parseFloat(playerObj.wi[activeWeek].p) : 0;
        return cachePts > 0 ? cachePts.toFixed(1) : '0.0';
    };

    const getMatchupText = (playerId) => {
        const playerObj = getPlayerObj(playerId);
        const feedKey = sleeperFeedKey(playerObj, playerId, foreignPlatform);
        const proj = feedKey ? weeklyProjections[feedKey] : null;
        const stats = feedKey ? weeklyStats[feedKey] : null;

        if (!playerObj && !proj && !stats) return '';

        const team = normalizeTeam(playerObj?.t || playerObj?.team);

        // 1. Precise Schedule Map (ESPN Data)
        if (team && nflScheduleMap[team]) {
            return nflScheduleMap[team];
        }

        // 2. Fallbacks
        let rawOpp = playerObj?.wi?.[activeWeek]?.opp || stats?.opponent || proj?.opponent || '';

        if (!rawOpp || rawOpp === '-' || rawOpp === 'BYE') return 'BYE';

        let isAway = rawOpp.includes('@');
        let cleanOpp = rawOpp.replace(/[@]/g, '').replace(/vs\.?/gi, '').trim().toUpperCase();

        return isAway ? `@ ${cleanOpp}` : `VS ${cleanOpp}`;
    };

    const getAvatar = (pId, pMeta) => {
        // Yahoo player IDs don't correspond to sleepercdn's photo paths (which
        // are keyed by Sleeper's own IDs) -- prefer Yahoo's own headshot when
        // we have one, and otherwise fall back through the crosswalked
        // sleeper_id rather than the raw (possibly Yahoo) id.
        if (pMeta?.headshot) return pMeta.headshot;
        const sleeperKey = pMeta?.sleeper_id || pId;
        return pMeta?.pos === 'DEF'
            ? `https://sleepercdn.com/images/team_logos/nfl/${String(sleeperKey).toLowerCase()}.png`
            : `https://sleepercdn.com/content/nfl/players/thumb/${sleeperKey}.jpg`;
    };

    const getPositionStyle = (cleanPos) => {
        const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'BN', 'IR', 'TAXI'];
        const basePos = validPositions.includes(cleanPos) ? cleanPos : 'BN';
        return { backgroundColor: `var(--${basePos})`, color: '#0b0e14' };
    };

    const renderPlayerRow = (playerId, positionLabel, rosterId) => {
        const player = getPlayerObj(playerId);
        const isPlaceholder = playerId === "0" || !player;
        
        const matchupText = getMatchupText(playerId);
        const injury = player ? getPlayerInjuryInfo(player) : null;

        return (
            <div 
                key={playerId + positionLabel + Math.random()} 
                className={styles.playerRow} 
                onClick={() => !isPlaceholder && setSelectedPlayer(player)}
                style={{ cursor: isPlaceholder ? 'default' : 'pointer' }}
            >
                <div className={styles.posBadge} style={getPositionStyle(positionLabel.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX'))}>
                    {positionLabel.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX')}
                </div>
                {isPlaceholder ? (
                    <div className={styles.playerInfoGroup}>
                        <div className={styles.playerImg} style={{ backgroundImage: `url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}></div>
                        <div className={styles.playerText}><span className={styles.pNameText}>Empty Slot</span></div>
                    </div>
                ) : (
                    <>
                        <div className={styles.playerInfoGroup}>
                            <div className={styles.playerImg} style={{ backgroundImage: `url(${getAvatar(playerId, player)}), url(https://sleepercdn.com/images/v2/icons/player_default.webp)` }}></div>
                            <div className={styles.playerMetaColLeft}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className={styles.pNameText}>{player.fn} {player.ln}</span>
                                    {injury && <span className={[styles.injTag, styles['inj_' + injury.tone]].filter(Boolean).join(' ')} title={injury.label}>{injury.code}</span>}
                                </div>
                                <div className={styles.posText}>{player.pos} • {player.t || 'FA'}</div>
                                {injury?.reason && <div className={styles.injReasonText}>{injury.label}: {injury.reason}</div>}
                                <div className={styles.schedText}>{matchupText}</div>
                            </div>
                        </div>
                        <div className={styles.scoreBlock}>
                            <span className={styles.playerLivePts}>{getPlayerLivePts(playerId, rosterId)}</span>
                            <span className={styles.playerProjSub}>{getPlayerProjPts(playerId)}</span>
                        </div>
                    </>
                )}
            </div>
        );
    };

    if (loading) return <div className={styles.loading}>Loading Teams...</div>;
    if (!leagueData || !teamManagers || Object.keys(rosters).length === 0) {
        return <div className={styles.loading}>No roster data available for this league.</div>;
    }

    const currentSeason = teamManagers.currentSeason;
    const rosterPositions = leagueData.roster_positions || [];

    const renderRosterCard = (rosterId, isConsolidated) => {
        const roster = rosters[rosterId];
        if (!roster) return null;
        
        const teamMeta = getTeamFromTeamManagers(teamManagers, rosterId, currentSeason);
        const teamStandings = standings[rosterId] || { wins: 0, losses: 0, ties: 0, fpts: 0 };
                 
        const starters = roster.starters || [];
        const allPlayers = roster.players || [];
        const reserve = roster.reserve || [];
        const taxi = roster.taxi || [];
        
        const startersSet = new Set(starters.map(String));
        const reserveSet = new Set(reserve.map(String));
        const taxiSet = new Set(taxi.map(String));
        
        const bench = allPlayers.filter(p => !startersSet.has(String(p)) && !reserveSet.has(String(p)) && !taxiSet.has(String(p)));
        const isBenchExpanded = expandedBenches[rosterId];
        const isTeamExpanded = viewMode === 'mine' || expandedTeams[rosterId];

        let teamProj = 0;
        starters.forEach(pId => {
            teamProj += parseFloat(getPlayerProjPts(pId));
        });

        return (
            <div key={rosterId} className={styles.rosterCard}>
                <div 
                    className={`${styles.teamHeader} ${viewMode === 'all' ? styles.clickable : ''}`} 
                    onClick={() => viewMode === 'all' && toggleTeamExpand(rosterId)}
                >
                    <img src={resolveImageSrc(teamMeta.avatar, '/fallback.png')} alt="Avatar" className={styles.teamAvatar} referrerPolicy="no-referrer" onError={onImageError(teamMeta.avatar, '/fallback.png')} />
                    <div className={styles.teamDetails}>
                        <h3 className={styles.teamName}>{teamMeta.name}</h3>
                        <div className={styles.teamStats}>
                            Record: {teamStandings.wins}-{teamStandings.losses}{teamStandings.ties > 0 ? `-${teamStandings.ties}` : ''} | PF: {parseFloat(teamStandings.fpts).toFixed(2)}
                        </div>
                        <select className={styles.weekDropdown} value={activeWeek} onChange={(e) => { e.stopPropagation(); setActiveWeek(parseInt(e.target.value)); }}>
                            {[...Array(18).keys()].map(i => <option key={i+1} value={i+1}>Week {i+1}</option>)}
                        </select>
                    </div>
                    {viewMode === 'all' && (
                        <i className="material-icons" style={{ marginLeft: 'auto', color: '#94a3b8' }}>
                            {expandedTeams[rosterId] ? 'expand_less' : 'expand_more'}
                        </i>
                    )}
                </div>

                <div className={styles.teamProjBar}>
                    <div className={styles.teamProjText}>Wk {activeWeek} Projection</div>
                    <div className={styles.teamProjValue}>{teamProj.toFixed(2)} pts</div>
                </div>

                {/* Only on the viewer's own team -- there's nothing to edit on
                    someone else's roster, and this link always lands on the
                    connected account's own team page regardless of which card
                    it's clicked from. Its own row (not stacked under the
                    points) so the projection bar stays a single line and this
                    sits right above the Starting Lineup/Bench headers instead. */}
                {String(rosterId) === String(myRosterId) && (
                    <div className={styles.editLineupRow}>
                        <a
                            className={styles.editLineupBtn}
                            href={platformLink.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <i className="material-icons">edit</i> Edit Lineup
                        </a>
                    </div>
                )}
                
                {isTeamExpanded && (
                    <div className={isConsolidated ? styles.rosterGridConsolidated : styles.rosterGrid}>
                        <div className={styles.rosterColumn}>
                            <h4 className={styles.sectionTitle}>Starting Lineup</h4>
                            <div className={styles.playerList}>
                                {starters.map((pId, idx) => renderPlayerRow(pId, rosterPositions[idx] || 'BN', rosterId))}
                            </div>
                        </div>
                        {isConsolidated ? (
                            <>
                                <button className={styles.toggleBenchBtn} onClick={(e) => { e.stopPropagation(); toggleBench(rosterId); }}>
                                    {isBenchExpanded ? 'Hide Bench' : 'Show Bench'}
                                </button>
                                                                 
                                {isBenchExpanded && (
                                    <div className={styles.rosterColumn}>
                                        <h4 className={styles.sectionTitle}>Bench</h4>
                                        <div className={styles.playerList}>{bench.map(pId => renderPlayerRow(pId, 'BN', rosterId))}</div>
                                        {reserve.length > 0 && (
                                            <>
                                                <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Injured Reserve</h4>
                                                <div className={styles.playerList}>{reserve.map(pId => renderPlayerRow(pId, 'IR', rosterId))}</div>
                                            </>
                                        )}
                                        {taxi.length > 0 && (
                                            <>
                                                <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Taxi Squad</h4>
                                                <div className={styles.playerList}>{taxi.map(pId => renderPlayerRow(pId, 'TAXI', rosterId))}</div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className={styles.rosterColumn}>
                                <h4 className={styles.sectionTitle}>Bench</h4>
                                <div className={styles.playerList}>{bench.map(pId => renderPlayerRow(pId, 'BN', rosterId))}</div>
                                {reserve.length > 0 && (
                                    <>
                                        <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Injured Reserve</h4>
                                        <div className={styles.playerList}>{reserve.map(pId => renderPlayerRow(pId, 'IR', rosterId))}</div>
                                    </>
                                )}
                                {taxi.length > 0 && (
                                    <>
                                        <h4 className={styles.sectionTitle} style={{ marginTop: '20px' }}>Taxi Squad</h4>
                                        <div className={styles.playerList}>{taxi.map(pId => renderPlayerRow(pId, 'TAXI', rosterId))}</div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={styles.container}>
            <div className={styles.controlsHeader}>
                <div className={styles.toggleContainer} onClick={handleToggleView}>
                    <div className={styles.toggleWrapper}>
                        <div className={`${styles.toggleSwitch} ${viewMode === 'all' ? styles.active : ''}`}></div>
                    </div>
                    <span className={styles.toggleLabel}>
                        {viewMode === 'mine' ? 'Show All Lineups' : 'Show My Lineup'}
                    </span>
                </div>
            </div>
            
            {viewMode === 'mine' ? (
                myRosterId ? renderRosterCard(myRosterId, false) : (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
                        Your team could not be automatically located in this league.
                    </div>
                )
            ) : (
                <div className={styles.allTeamsGrid}>
                    {Object.keys(rosters).map(rId => renderRosterCard(rId, true))}
                </div>
            )}

            {selectedPlayer && (
                <PlayerModal 
                    player={selectedPlayer} 
                    week={activeWeek} 
                    onClose={() => setSelectedPlayer(null)} 
                />
            )}
        </div>
    );
}