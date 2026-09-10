import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import { getLeagueRosters, getLeagueTeamManagers, loadPlayers, getLeagueData, getNflState } from '../utils/helper';
import { getTeamFromTeamManagers } from '../utils/helperFunctions/universalFunctions';
import { resolvePlayerFromMeta, entryOwnsLookupId } from '../utils/playerPool';
import { scoreStatLine } from '../utils/yahooScoring';
import { fetchAndNormalizeYahooMatchups } from '../utils/yahooService';
import { fetchAndNormalizeESPNMatchups, fetchAndNormalizeESPNRosters } from '../utils/espnService';
import { isViewingLiveWeek, LIVE_SCORE_POLL_MS } from '../utils/liveScores';
import { isYahooLeagueId, isEspnLeagueId, isForeignPlatformLeague, sleeperFeedKey } from '../utils/platformIds';
import { resolveImageSrc, onImageError } from '../utils/imageFallback';
import { getPlayerInjuryInfo } from '../utils/injuryStatus';
import { buildLiveStatLine } from '../utils/playerStatLine';
import PlayerModal from '../components/PlayerModal';
import styles from './Matchups.module.css';

export default function Matchups() {
    const { activeLeague } = useLeague();
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
    const [myRosterId, setMyRosterId] = useState(null);
    
    const [viewMode, setViewMode] = useState('mine'); 
    const [activeWeek, setActiveWeek] = useState(1);
    
    const [weeklyMatchups, setWeeklyMatchups] = useState([]);
    const [weeklyProjections, setWeeklyProjections] = useState({});
    const [weeklyStats, setWeeklyStats] = useState({});
    const [nflScheduleMap, setNflScheduleMap] = useState({});
    // Per-NFL-team game state ('pre'|'in'|'post' + a short clock string),
    // keyed the same way as nflScheduleMap -- built from the same ESPN
    // scoreboard poll, just reading its status field too instead of only
    // the matchup for the opponent label.
    const [nflLiveMap, setNflLiveMap] = useState({});
    // The real current NFL week -- used both to land on the right week by
    // default and to decide whether the viewed week is even worth polling for
    // live updates (a past or future week's data never changes).
    const [nflState, setNflState] = useState(null);
    
    const [selectedMatchupId, setSelectedMatchupId] = useState(null);
    const [expandedMatchups, setExpandedMatchups] = useState({});
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [showBench, setShowBench] = useState({});

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

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const sleeperId = activeLeague.sleeper_league_id;
                const [rData, tmData, pData, lData, nState] = await Promise.all([
                    getLeagueRosters(sleeperId),
                    getLeagueTeamManagers(sleeperId),
                    loadPlayers(sleeperId),
                    getLeagueData(sleeperId),
                    getNflState().catch(() => null)
                ]);
                if (!isMounted) return;

                setRosters(rData.rosters || {});
                setYahooPlayersMeta(rData.yahooPlayersMeta || {});
                setTeamManagers(tmData);
                setPlayersInfo(pData.players || {});
                setPlayersByName(pData.playersByName || {});
                setLeagueData(lData);
                setNflState(nState);

                // `leagueData` (Sleeper or Yahoo) carries no "current week" field
                // of its own -- the real NFL state is the one source both
                // platforms can be landed on correctly by.
                if (nState?.season_type === 'regular') setActiveWeek(nState.display_week || nState.week || 1);
                else if (nState?.season_type === 'post') setActiveWeek(18);

                if (isYahooLeagueId(sleeperId) || isEspnLeagueId(sleeperId)) {
                    // Yahoo flags the requesting user's own team directly, and
                    // ESPN's roster fetch resolves the same flag from the
                    // connecting account's SWID -- both reliable regardless of
                    // what (if anything) got stored as the connection's
                    // team_name, unlike the string-matching path below.
                    const ownedRoster = Object.values(rData.rosters || {}).find(r => r.is_owned_by_current_login);
                    if (ownedRoster) setMyRosterId(ownedRoster.roster_id);
                } else {
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
                        if (searchName) {
                            const rostersMap = tmData.teamManagersMap[tmData.currentSeason] || {};
                            const foundRosterId = Object.keys(rostersMap).find(rId => normalizeStr(rostersMap[rId].team?.name) === searchName);
                            if (foundRosterId) setMyRosterId(foundRosterId);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to load matchups:", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    useEffect(() => {
        const season = leagueData?.season || new Date().getFullYear();
        if (!activeLeague?.sleeper_league_id) return;
        let isMounted = true;

        const applyMatchupData = (mData) => {
            if (!isMounted) return;
            setWeeklyMatchups(mData || []);
            if (myRosterId && Array.isArray(mData)) {
                const userM = mData.find(m => m.roster_id === parseInt(myRosterId));
                if (userM) setSelectedMatchupId(userM.matchup_id);
                else if (mData.length > 0) setSelectedMatchupId(mData[0].matchup_id);
            } else if (mData && mData.length > 0) {
                setSelectedMatchupId(mData[0].matchup_id);
            }
        };

        // Scores, live per-player points and box-score stats all move while a
        // game is being played, so this whole block is re-run on a timer below
        // rather than fetched once -- otherwise a matchup only ever updated on
        // a manual reload or a week change, no matter how the games were going.
        const loadLiveData = () => {
            if (isYahooLeagueId(activeLeague.sleeper_league_id)) {
                fetchAndNormalizeYahooMatchups(activeLeague.sleeper_league_id, activeWeek)
                    .then(({ matchups }) => {
                        const flat = [];
                        Object.entries(matchups || {}).forEach(([mId, pair]) => {
                            pair.forEach(team => flat.push({ ...team, matchup_id: mId }));
                        });
                        applyMatchupData(flat);
                    })
                    .catch(err => console.error("Yahoo matchups fetch err:", err));
            } else if (isEspnLeagueId(activeLeague.sleeper_league_id)) {
                fetchAndNormalizeESPNMatchups(activeLeague.sleeper_league_id, activeWeek)
                    .then(({ matchups }) => {
                        const flat = [];
                        Object.entries(matchups || {}).forEach(([mId, pair]) => {
                            pair.forEach(team => flat.push({ ...team, matchup_id: mId }));
                        });
                        applyMatchupData(flat);
                    })
                    .catch(err => console.error("ESPN matchups fetch err:", err));

                // ESPN pre-computes each player's real, week-specific projected and
                // actual points under the league's own rules -- far more reliable
                // than reconstructing them from Sleeper's generic feed, especially
                // for defenses, which that feed barely covers.
                fetchAndNormalizeESPNRosters(activeLeague.sleeper_league_id, { week: activeWeek })
                    .then(({ rosters: weekRosters, yahooPlayersMeta: weekMeta }) => {
                        if (!isMounted) return;
                        if (weekMeta) setYahooPlayersMeta(prev => ({ ...prev, ...weekMeta }));
                        // The lineups too, not just the points: the starters
                        // rendered here come from the roster fetch, and the
                        // league-level one is always TODAY's lineup. Without
                        // this, opening a past week showed that week's scores
                        // against the current lineup -- players who were never
                        // started that week, and none of the ones who were.
                        if (weekRosters && Object.keys(weekRosters).length) setRosters(weekRosters);
                    })
                    .catch(err => console.error("ESPN weekly roster/points fetch err:", err));
            } else {
                fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}/matchups/${activeWeek}`)
                    .then(res => res.json())
                    .then(applyMatchupData)
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
                        const liveMap = {};
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

                                    // Same event, just its status this time -- 'in' is
                                    // the only state worth a live badge over ('pre'/
                                    // 'post' are already implied by the opponent line
                                    // and the final score respectively).
                                    const statusType = event.status?.type || comp.status?.type;
                                    if (statusType) {
                                        const info = { state: statusType.state, detail: statusType.shortDetail || '' };
                                        liveMap[home] = info;
                                        liveMap[away] = info;
                                    }
                                }
                            }
                        });
                        setNflScheduleMap(map);
                        setNflLiveMap(liveMap);
                    }
                })
                .catch(err => console.error("ESPN Schedule fetch err:", err));
        };

        loadLiveData();

        let intervalId = null;
        if (isViewingLiveWeek(nflState, activeWeek)) {
            intervalId = setInterval(() => {
                // Skip a tick on a backgrounded tab -- there's no one watching
                // it update, and it'll catch up the moment it's visible again.
                if (document.hidden) return;
                loadLiveData();
            }, LIVE_SCORE_POLL_MS);
        }

        return () => {
            isMounted = false;
            if (intervalId) clearInterval(intervalId);
        };
    }, [activeLeague, activeWeek, leagueData?.season, myRosterId, nflState]);

    const getPlayerLivePts = (pId, matchupObj) => {
        if (!pId || pId === "0") return '0.00';
        if (matchupObj?.players_points && matchupObj.players_points[pId] !== undefined) {
            return parseFloat(matchupObj.players_points[pId]).toFixed(2);
        }
        const actual = getPlayerObj(pId)?.actualPoints;
        if (Number.isFinite(actual)) return actual.toFixed(2);
        return '0.00';
    };

    const getPlayerProjPts = (pId) => {
        if (!pId || pId === "0") return '0.00';
        const playerObj = getPlayerObj(pId);
        if (Number.isFinite(playerObj?.projectedPoints)) return playerObj.projectedPoints.toFixed(1);
        // Sleeper's projections/stats feeds are keyed by Sleeper player ids, and
        // a Yahoo/ESPN roster id looked up in them doesn't harmlessly miss -- the
        // id spaces overlap, so it returns an unrelated player's stat line. Only
        // the crosswalked sleeper_id may be used here (see sleeperFeedKey).
        const feedKey = sleeperFeedKey(playerObj, pId, foreignPlatform);
        const proj = feedKey ? (weeklyProjections[feedKey] || weeklyStats[feedKey]) : null;
        const scoringSettings = leagueData?.scoring_settings || {};

        if (proj) {
            const stats = proj.stats || proj || {};
            // Score against the league's own rules (defense tiers, kicker FG
            // distances); null means the line carried none of the scored stats.
            const scored = scoreStatLine(stats, scoringSettings, playerObj?.pos);
            if (scored !== null) return scored.toFixed(2);
            
            const rec = scoringSettings.rec || 0;
            let key = 'pts_std';
            if (rec === 1) key = 'pts_ppr';
            else if (rec === 0.5) key = 'pts_half_ppr';
            const basePts = stats[key] || proj[key] || 0;
            if (basePts > 0) return parseFloat(basePts).toFixed(2);
        }
        const cachePts = playerObj?.wi?.[activeWeek]?.p ? parseFloat(playerObj.wi[activeWeek].p) : 0;
        return cachePts > 0 ? cachePts.toFixed(2) : '0.00';
    };

    const getMatchupOpp = (pId) => {
        const playerObj = getPlayerObj(pId);
        const feedKey = sleeperFeedKey(playerObj, pId, foreignPlatform);
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

    // Only 'in' is worth surfacing -- a not-yet-started or already-final game
    // is already implied by the opponent line and the score itself.
    const getLiveGameStatus = (pId) => {
        const playerObj = getPlayerObj(pId);
        const team = normalizeTeam(playerObj?.t || playerObj?.team);
        const info = team ? nflLiveMap[team] : null;
        return info?.state === 'in' ? info : null;
    };

    const getLiveStatLine = (pId) => {
        const playerObj = getPlayerObj(pId);
        const feedKey = sleeperFeedKey(playerObj, pId, foreignPlatform);
        const stats = feedKey ? weeklyStats[feedKey] : null;
        return buildLiveStatLine(playerObj?.pos, stats);
    };

    // Shared by all four starter/bench cells: the opponent line (with a live
    // badge appended while that game is in progress) plus, right under it,
    // the player's real stat line so far -- same place the injury reason
    // used to sit before that got dropped for clutter.
    const renderScheduleAndStats = (pId) => {
        const liveStatus = getLiveGameStatus(pId);
        const statLine = getLiveStatLine(pId);
        return (
            <>
                <div className={styles.schedText}>
                    {getMatchupOpp(pId)}
                    {liveStatus && <span className={styles.liveBadge}>{liveStatus.detail || 'LIVE'}</span>}
                </div>
                {statLine && <div className={styles.liveStatLine}>{statLine}</div>}
            </>
        );
    };

    const formatShortName = (pObj) => {
        if (!pObj) return 'Empty';
        if (!pObj.fn || !pObj.ln) return pObj.name || 'Player';
        return `${pObj.fn.charAt(0)}. ${pObj.ln}`;
    };

    // Shared by all four starter/bench name cells (left/right x starters/bench)
    // so the injury tag only has to be built in one place. Just the short
    // code (Q/O/D/IR/...) -- the full reason is one tap away in the player
    // modal, and printing it here on every dense tile was more clutter than
    // signal.
    const renderNameWithInjury = (pObj, emptyLabel) => {
        if (!pObj) return <div className={styles.pNameText}>{emptyLabel}</div>;
        const injury = getPlayerInjuryInfo(pObj);
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div className={styles.pNameText}>{formatShortName(pObj)}</div>
                {injury && <span className={[styles.injTag, styles['inj_' + injury.tone]].filter(Boolean).join(' ')} title={injury.label}>{injury.code}</span>}
            </div>
        );
    };

    const toggleMatchupExpand = (mId) => {
        setExpandedMatchups(prev => ({ ...prev, [mId]: !prev[mId] }));
    };

    const toggleBenchExpand = (mId) => {
        setShowBench(prev => ({ ...prev, [mId]: !prev[mId] }));
    };

    if (loading) return <div className={styles.loading}>Loading Matchups...</div>;

    const matchupGroups = {};
    weeklyMatchups.forEach(m => {
        if (!matchupGroups[m.matchup_id]) matchupGroups[m.matchup_id] = [];
        matchupGroups[m.matchup_id].push(m);
    });

    const currentSeason = teamManagers?.currentSeason;
    const rosterPositions = leagueData?.roster_positions || [];

    const renderMatchupCard = (mId, pair, isSingleView = false) => {
        const leftTeamMatchup = pair[0] || null;
        const rightTeamMatchup = pair[1] || null;

        const leftTeamMeta = leftTeamMatchup ? getTeamFromTeamManagers(teamManagers, leftTeamMatchup.roster_id, currentSeason) : null;
        const rightTeamMeta = rightTeamMatchup ? getTeamFromTeamManagers(teamManagers, rightTeamMatchup.roster_id, currentSeason) : null;

        const leftRoster = leftTeamMatchup ? rosters[leftTeamMatchup.roster_id] : null;
        const rightRoster = rightTeamMatchup ? rosters[rightTeamMatchup.roster_id] : null;

        const leftStarters = leftRoster?.starters || [];
        const rightStarters = rightRoster?.starters || [];

        // ESPN's own mMatchup "totalPoints" field doesn't reliably track a
        // game in progress -- it lags behind the per-player boxscore stats
        // getPlayerLivePts already reads correctly (from the roster fetch),
        // so an ESPN team's live total is summed from its own starters
        // instead of trusted off the schedule response, the same way
        // leftProjTotal/rightProjTotal below are already summed rather than
        // read off a single field. Sleeper/Yahoo's own team totals already
        // update live as-is, so they're left reading straight off `.points`.
        const isEspnMatchup = isEspnLeagueId(activeLeague?.sleeper_league_id);
        let leftLiveScore = leftTeamMatchup?.points || 0;
        let rightLiveScore = rightTeamMatchup?.points || 0;
        if (isEspnMatchup) {
            leftLiveScore = leftStarters.reduce((sum, id) => sum + parseFloat(getPlayerLivePts(id, leftTeamMatchup) || 0), 0);
            rightLiveScore = rightStarters.reduce((sum, id) => sum + parseFloat(getPlayerLivePts(id, rightTeamMatchup) || 0), 0);
        }

        let leftProjTotal = 0;
        leftStarters.forEach(id => leftProjTotal += parseFloat(getPlayerProjPts(id)));
        let rightProjTotal = 0;
        rightStarters.forEach(id => rightProjTotal += parseFloat(getPlayerProjPts(id)));

        let leftWinProb = 50;
        let rightWinProb = 50;
        if (leftProjTotal + rightProjTotal > 0) {
            leftWinProb = Math.round((leftProjTotal / (leftProjTotal + rightProjTotal)) * 100);
            rightWinProb = 100 - leftWinProb;
        }

        const isLeftHigher = leftWinProb >= rightWinProb;
        const leftOddStyle = isLeftHigher ? styles.goldOdd : styles.redOdd;
        const rightOddStyle = !isLeftHigher ? styles.goldOdd : styles.redOdd;

        const leftBench = leftRoster?.players ? leftRoster.players.filter(p => !leftStarters.includes(p)) : [];
        const rightBench = rightRoster?.players ? rightRoster.players.filter(p => !rightStarters.includes(p)) : [];
        const maxBenchLength = Math.max(leftBench.length, rightBench.length);

        const isExpanded = isSingleView || expandedMatchups[mId];

        return (
            <div key={mId} className={styles.matchupCard}>
                <div 
                    className={`${styles.matchupBanner} ${!isSingleView ? styles.clickableBanner : ''}`}
                    onClick={() => !isSingleView && toggleMatchupExpand(mId)}
                >
                    <div className={styles.bannerTeam}>
                        <div className={styles.avatarRow}>
                            <img src={resolveImageSrc(leftTeamMeta?.avatar, '/fallback.png')} alt="" className={styles.bannerAvatar} referrerPolicy="no-referrer" onError={onImageError(leftTeamMeta?.avatar, '/fallback.png')} />
                            <span className={`${styles.winBadge} ${leftOddStyle}`}>{leftWinProb}% WIN</span>
                        </div>
                        <div className={styles.scoreGroup}>
                            <span className={styles.teamLiveScore}>{leftLiveScore.toFixed(2)}</span>
                            <span className={styles.teamProjSub}>Proj {leftProjTotal.toFixed(2)}</span>
                        </div>
                        <div className={styles.bannerTeamName}>{leftTeamMeta?.name || 'Home Team'}</div>
                    </div>

                    <div className={styles.bannerVsBadge}>
                        <i className="material-icons">bolt</i>
                    </div>

                    <div className={styles.bannerTeam} style={{ alignItems: 'flex-end', textAlign: 'right' }}>
                        <div className={styles.avatarRow} style={{ flexDirection: 'row-reverse' }}>
                            <img src={resolveImageSrc(rightTeamMeta?.avatar, '/fallback.png')} alt="" className={styles.bannerAvatar} referrerPolicy="no-referrer" onError={onImageError(rightTeamMeta?.avatar, '/fallback.png')} />
                            <span className={`${styles.winBadge} ${rightOddStyle}`}>{rightWinProb}% WIN</span>
                        </div>
                        <div className={styles.scoreGroup} style={{ alignItems: 'flex-end' }}>
                            <span className={styles.teamLiveScore}>{rightLiveScore.toFixed(2)}</span>
                            <span className={styles.teamProjSub}>Proj {rightProjTotal.toFixed(2)}</span>
                        </div>
                        <div className={styles.bannerTeamName}>{rightTeamMeta?.name || 'Away Team'}</div>
                    </div>
                </div>

                {isExpanded && (
                    <div className={styles.startersSection}>
                        <h4 className={styles.startersHeader}>Starters</h4>
                        <div className={styles.matchupGrid}>
                            {leftStarters.map((leftPId, idx) => {
                                const rightPId = rightStarters[idx] || "0";
                                const posLabel = rosterPositions[idx] || 'FLEX';
                                const leftP = getPlayerObj(leftPId);
                                const rightP = getPlayerObj(rightPId);
                                const cleanPos = posLabel.replace('WRRB_FLEX', 'FLEX').replace('SUPER_FLEX', 'S/FLEX');

                                return (
                                    <div key={idx} className={styles.starterRow}>
                                        <div className={styles.leftPlayer} onClick={() => leftP && setSelectedPlayer(leftP)}>
                                            <div className={styles.playerMetaColLeft}>
                                                {renderNameWithInjury(leftP, 'Empty Slot')}
                                                {leftP && (
                                                    <>
                                                        <div className={styles.posText}>{leftP.pos} • {leftP.t || 'FA'}</div>
                                                        {renderScheduleAndStats(leftPId)}
                                                    </>
                                                )}
                                            </div>
                                            <div className={styles.scoreBlock} style={{ alignItems: 'flex-end' }}>
                                                <span className={styles.playerLivePts}>{getPlayerLivePts(leftPId, leftTeamMatchup)}</span>
                                                <span className={styles.playerProjSub}>{getPlayerProjPts(leftPId)}</span>
                                            </div>
                                        </div>

                                        <div className={styles.centerPosBadge} style={{ backgroundColor: `var(--${(cleanPos || 'BN').toUpperCase()})` }}>
                                            {cleanPos}
                                        </div>

                                        <div className={styles.rightPlayer} onClick={() => rightP && setSelectedPlayer(rightP)}>
                                            <div className={styles.scoreBlock} style={{ alignItems: 'flex-start' }}>
                                                <span className={styles.playerLivePts}>{getPlayerLivePts(rightPId, rightTeamMatchup)}</span>
                                                <span className={styles.playerProjSub}>{getPlayerProjPts(rightPId)}</span>
                                            </div>
                                            <div className={styles.playerMetaColRight}>
                                                {renderNameWithInjury(rightP, 'Empty Slot')}
                                                {rightP && (
                                                    <>
                                                        <div className={styles.posText}>{rightP.pos} • {rightP.t || 'FA'}</div>
                                                        {renderScheduleAndStats(rightPId)}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button className={styles.benchToggleBtn} onClick={() => toggleBenchExpand(mId)}>
                            {showBench[mId] ? 'Hide Bench' : 'Show Bench'}
                        </button>

                        {showBench[mId] && (
                            <div className={styles.benchSection}>
                                <h4 className={styles.startersHeader} style={{ marginTop: '20px' }}>Bench</h4>
                                <div className={styles.matchupGrid}>
                                    {[...Array(maxBenchLength).keys()].map((idx) => {
                                        const leftPId = leftBench[idx] || "0";
                                        const rightPId = rightBench[idx] || "0";
                                        const leftP = getPlayerObj(leftPId);
                                        const rightP = getPlayerObj(rightPId);

                                        return (
                                            <div key={`bench-${idx}`} className={styles.starterRow}>
                                                <div className={styles.leftPlayer} onClick={() => leftP && setSelectedPlayer(leftP)}>
                                                    <div className={styles.playerMetaColLeft}>
                                                        {renderNameWithInjury(leftP, 'Empty')}
                                                        {leftP && (
                                                            <>
                                                                <div className={styles.posText}>{leftP.pos} • {leftP.t || 'FA'}</div>
                                                                {renderScheduleAndStats(leftPId)}
                                                            </>
                                                        )}
                                                    </div>
                                                    <div className={styles.scoreBlock} style={{ alignItems: 'flex-end' }}>
                                                        <span className={styles.playerLivePts}>{getPlayerLivePts(leftPId, leftTeamMatchup)}</span>
                                                        <span className={styles.playerProjSub}>{getPlayerProjPts(leftPId)}</span>
                                                    </div>
                                                </div>

                                                <div className={styles.centerPosBadge} style={{ backgroundColor: '#334155', color: '#f8fafc' }}>
                                                    BN
                                                </div>

                                                <div className={styles.rightPlayer} onClick={() => rightP && setSelectedPlayer(rightP)}>
                                                    <div className={styles.scoreBlock} style={{ alignItems: 'flex-start' }}>
                                                        <span className={styles.playerLivePts}>{getPlayerLivePts(rightPId, rightTeamMatchup)}</span>
                                                        <span className={styles.playerProjSub}>{getPlayerProjPts(rightPId)}</span>
                                                    </div>
                                                    <div className={styles.playerMetaColRight}>
                                                        {renderNameWithInjury(rightP, 'Empty')}
                                                        {rightP && (
                                                            <>
                                                                <div className={styles.posText}>{rightP.pos} • {rightP.t || 'FA'}</div>
                                                                {renderScheduleAndStats(rightPId)}
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    let userMatchupPair = null;
    let userMatchupId = null;

    if (myRosterId && weeklyMatchups.length > 0) {
        const myM = weeklyMatchups.find(m => m.roster_id === parseInt(myRosterId));
        if (myM) {
            userMatchupId = myM.matchup_id;
            userMatchupPair = matchupGroups[userMatchupId] || null;
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.controlsHeader}>
                <div className={styles.toggleContainer} onClick={() => setViewMode(viewMode === 'mine' ? 'all' : 'mine')}>
                    <div className={styles.toggleWrapper}>
                        <div className={`${styles.toggleSwitch} ${viewMode === 'all' ? styles.active : ''}`}></div>
                    </div>
                    <span className={styles.toggleLabel}>
                        {viewMode === 'mine' ? 'Show All Matchups' : 'Show My Matchup'}
                    </span>
                </div>

                <select 
                    className={styles.weekDropdown} 
                    value={activeWeek} 
                    onChange={(e) => setActiveWeek(parseInt(e.target.value))}
                >
                    {[...Array(18).keys()].map(i => (
                        <option key={i+1} value={i+1}>Week {i+1}</option>
                    ))}
                </select>
            </div>

            {viewMode === 'mine' ? (
                userMatchupPair ? (
                    renderMatchupCard(userMatchupId, userMatchupPair, true)
                ) : (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
                        Your matchup could not be found for Week {activeWeek}.
                    </div>
                )
            ) : (
                <div className={styles.allMatchupsGrid}>
                    {Object.entries(matchupGroups).map(([mId, pair]) => renderMatchupCard(mId, pair, false))}
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