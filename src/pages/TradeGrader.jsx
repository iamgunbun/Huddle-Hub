import React, { useState, useEffect, useMemo } from 'react';
import { useLeague } from '../context/LeagueContext';
import { loadPlayers, getLeagueData, getLeagueRosters, getNflState } from '../utils/helper';
import { sleeperLeagueFormat, estimateLeagueFormatFromRosterSets, formatLabel } from '../utils/leagueFormat';
import styles from './TradeGrader.module.css';
import { isYahooLeagueId, isEspnLeagueId } from '../utils/platformIds';
import { resolveRosterPlayers } from '../utils/playerPool';
import { attachSleeperTeamNames, sleeperOwnerIdsByName, pickMyRosterId } from '../utils/leaguePreview';
import {
    findTrades, makeRosValue, startingSlots, playerLabel,
    indexBlocksByRoster, BLOCK_POSITIONS,
} from '../utils/tradeFinder';
import { supabase } from '../supabaseClient';

// Fantasy regular seasons end here in every format this app supports, so
// rest-of-season value stops counting at it rather than running to week 18.
const FANTASY_LAST_WEEK = 17;

const parseGraderResponse = (rawText) => {
    try { 
        return JSON.parse(rawText); 
    } catch (e) {
        let clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        while (clean.endsWith('}')) { 
            try { 
                return JSON.parse(clean); 
            } catch (err) { 
                clean = clean.slice(0, -1).trim(); 
            } 
        }
        throw new Error("JSON format error.");
    }
};

export default function TradeGrader() {
    const { activeLeague, isPremium, setShowPremiumModal } = useLeague();
    const [loading, setLoading] = useState(true);
    const [playersInfo, setPlayersInfo] = useState({});
    
    // Trade State
    // Redraft, not Dynasty, is the safer default while detection is still
    // running -- most leagues are redraft, and Yahoo (see below) has no field
    // to read at all, so a wrong default should be the common case, not the
    // rare one.
    const [leagueType, setLeagueType] = useState('Redraft');
    const [formatDetection, setFormatDetection] = useState({ source: 'default', sampleSize: 0 });
    const [sideA, setSideA] = useState([]);
    const [sideB, setSideB] = useState([]);
    
    // Modal States
    const [isSearchOpen, setIsSearchOpen] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isPickModalOpen, setIsPickModalOpen] = useState(null);
    const [pickYear, setPickYear] = useState(new Date().getFullYear());
    const [pickRound, setPickRound] = useState(1);

    // Which half of the tool is showing. Grading a trade you already have in
    // mind and hunting for one you don't are the same question asked from
    // opposite ends, so they share a page, a format setting and a roster load.
    const [mode, setMode] = useState('grade');
    const [finder, setFinder] = useState({ status: 'idle', proposals: [], excluded: [], note: null });
    const [block, setBlock] = useState({ shopping: [], needs: [], note: '' });
    const [blockState, setBlockState] = useState({ status: 'idle', message: null });
    const [matchingOnly, setMatchingOnly] = useState(false);
    const [leagueBlocks, setLeagueBlocks] = useState([]);
    // user_id -> claimed team name, so a posted block can say whose it is.
    const [blockClaims, setBlockClaims] = useState([]);
    const [myUserId, setMyUserId] = useState(null);

    // Engine States
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [gradeResult, setGradeResult] = useState(null);
    const [uiErrorMessage, setUiErrorMessage] = useState(null);

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                const leagueId = activeLeague.sleeper_league_id;
                const [pData, lData] = await Promise.all([
                    loadPlayers(leagueId),
                    getLeagueData(leagueId)
                ]);
                if (!isMounted) return;
                setPlayersInfo(pData?.players || pData || {});
                setLoading(false);

                // Sleeper says its own format directly. Yahoo's league object has
                // no such field at all -- there is nothing correct to read here,
                // so the format is instead estimated from how many players
                // carried over from last season's rosters to this one (see
                // src/utils/leagueFormat.js). That needs an extra fetch, so it
                // runs after the page is already usable rather than blocking it.
                if (!isYahooLeagueId(leagueId)) {
                    setLeagueType(formatLabel(sleeperLeagueFormat(lData?.settings?.type)));
                    setFormatDetection({ source: 'sleeper-settings', sampleSize: null });
                    return;
                }

                if (!lData?.previous_league_id) {
                    // A brand new Yahoo league has no prior season to compare
                    // against -- Redraft (the default already set) is the honest
                    // answer, not a guess dressed up as a detection.
                    setFormatDetection({ source: 'no-prior-season', sampleSize: 0 });
                    return;
                }

                const [currentRosters, priorRosters] = await Promise.all([
                    getLeagueRosters(leagueId),
                    getLeagueRosters(lData.previous_league_id),
                ]);
                if (!isMounted) return;

                const estimate = estimateLeagueFormatFromRosterSets(
                    Object.values(currentRosters?.rosters || {}),
                    Object.values(priorRosters?.rosters || {})
                );
                if (estimate.format) {
                    setLeagueType(formatLabel(estimate.format));
                    setFormatDetection({ source: 'roster-carryover', sampleSize: estimate.sampleSize });
                } else {
                    setFormatDetection({ source: 'no-comparable-rosters', sampleSize: 0 });
                }
            } catch (e) {
                console.error("Failed to load grader engine:", e);
                if (isMounted) setLoading(false);
            }
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim() || !playersInfo) return [];
        const q = searchQuery.toLowerCase().trim();
        return Object.values(playersInfo)
            .filter(p => {
                if (!p || p.active === false || p.status === 'Retired') return false;
                const fn = (p.fn || p.first_name || '').toLowerCase();
                const ln = (p.ln || p.last_name || '').toLowerCase();
                const fullName = `${fn} ${ln}`.trim();
                return fn.includes(q) || ln.includes(q) || fullName.includes(q);
            })
            .sort((a, b) => (a.search_rank || 99999) - (b.search_rank || 99999))
            .slice(0, 20);
    }, [searchQuery, playersInfo]);

    const handleAddPlayer = (player) => {
        const asset = { ...player, assetType: 'player', uniqueId: player.player_id || player.id };
        if (isSearchOpen === 'A') setSideA(prev => [...prev, asset]);
        if (isSearchOpen === 'B') setSideB(prev => [...prev, asset]);
        setIsSearchOpen(null);
        setSearchQuery('');
        setGradeResult(null);
        setUiErrorMessage(null);
    };

    const handleAddPick = () => {
        const asset = {
            assetType: 'pick',
            uniqueId: `pick-${pickYear}-${pickRound}-${Date.now()}`,
            year: pickYear,
            round: pickRound
        };
        if (isPickModalOpen === 'A') setSideA(prev => [...prev, asset]);
        if (isPickModalOpen === 'B') setSideB(prev => [...prev, asset]);
        setIsPickModalOpen(null);
        setGradeResult(null);
        setUiErrorMessage(null);
    };

    const handleRemoveAsset = (side, uniqueId) => {
        if (side === 'A') setSideA(prev => prev.filter(a => a.uniqueId !== uniqueId));
        if (side === 'B') setSideB(prev => prev.filter(a => a.uniqueId !== uniqueId));
        setGradeResult(null);
    };

    const handleClearTrade = () => {
        setSideA([]);
        setSideB([]);
        setGradeResult(null);
        setUiErrorMessage(null);
    };

    const getAvatar = (p) => {
        if (p.headshot) return p.headshot;
        const pos = p.pos || p.position;
        // In a Yahoo league the shared dictionary is keyed by Yahoo's own player
        // id (so a Yahoo roster can look a player up directly), so `.id`/
        // `.player_id` is a YAHOO id for any player the crosswalk knows -- not
        // something sleepercdn's image URLs understand. `.sleeper_id` is always
        // the real Sleeper id, set on every dictionary entry regardless of
        // platform, and is what these URLs actually need.
        const pId = p.sleeper_id || p.player_id || p.id;
        const team = p.team || p.t || pId;

        if (pos === 'DEF') return `https://sleepercdn.com/images/team_logos/nfl/${String(team).toLowerCase()}.png`;
        return `https://sleepercdn.com/content/nfl/players/thumb/${pId}.jpg`;
    };

    // The league's declared blocks, read once the tool is open. Failing to
    // read them is not an error worth showing: the finder works without any,
    // which is the whole reason this could ship after it.
    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.id) return;
            const { data: { session } } = await supabase.auth.getSession();
            // Claims come along for the ride: a block with no name on it says
            // somebody wants a running back but not who to go and ask, and the
            // search needs the same join to know whose block is whose.
            const [{ data, error }, { data: claims }] = await Promise.all([
                supabase
                    .from('league_trade_blocks')
                    .select('user_id, shopping, needs, players, note, updated_at')
                    .eq('league_id', activeLeague.id),
                supabase
                    .from('user_leagues')
                    .select('user_id, team_name')
                    .eq('league_id', activeLeague.id),
            ]);
            if (!isMounted || error) {
                if (error) console.warn('Trade blocks unavailable:', error.message);
                return;
            }
            setMyUserId(session?.user?.id || null);
            setBlockClaims(claims || []);
            setLeagueBlocks(data || []);
            const mine = (data || []).find(b => b.user_id === session?.user?.id);
            if (mine) setBlock({ shopping: mine.shopping || [], needs: mine.needs || [], note: mine.note || '' });
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague?.id]);

    /**
     * The posted blocks, named and ordered for reading.
     *
     * A row where nobody declared anything is dropped: an empty block is what
     * you get from opening the tab and saving by accident, and showing it
     * tells a reader nothing while making the league look busier than it is.
     * Yours sorts first so a save visibly lands.
     */
    const postedBlocks = useMemo(() => {
        const nameFor = (userId) =>
            blockClaims.find(c => c.user_id === userId)?.team_name || 'A leaguemate';
        return (leagueBlocks || [])
            .filter(b => (b.shopping?.length || b.needs?.length || (b.note || '').trim()))
            .map(b => ({ ...b, teamName: nameFor(b.user_id), isMine: b.user_id === myUserId }))
            .sort((a, b) =>
                (b.isMine ? 1 : 0) - (a.isMine ? 1 : 0)
                || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
                || a.teamName.localeCompare(b.teamName));
    }, [leagueBlocks, blockClaims, myUserId]);

    const toggleBlockPos = (field, pos) => {
        setBlock(prev => ({
            ...prev,
            [field]: prev[field].includes(pos)
                ? prev[field].filter(p => p !== pos)
                : [...prev[field], pos],
        }));
        setBlockState({ status: 'idle', message: null });
    };

    const saveBlock = async () => {
        setBlockState({ status: 'saving', message: null });
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) throw new Error('You need to be signed in to post a block.');
            const row = {
                league_id: activeLeague.id,
                user_id: session.user.id,
                shopping: block.shopping,
                needs: block.needs,
                note: block.note?.trim() || null,
                updated_at: new Date().toISOString(),
            };
            const { error } = await supabase
                .from('league_trade_blocks')
                .upsert(row, { onConflict: 'league_id,user_id' });
            if (error) throw error;
            setLeagueBlocks(prev => [...prev.filter(b => b.user_id !== session.user.id), row]);
            setBlockState({ status: 'saved', message: 'Posted to your league.' });
            // A saved block changes the ranking, so a stale result list would
            // be quietly wrong -- drop it rather than leave it up.
            setFinder({ status: 'idle', proposals: [], excluded: [], note: null });
        } catch (err) {
            setBlockState({ status: 'error', message: err.message });
        }
    };

    /**
     * Searches every other roster in the league for swaps that raise BOTH
     * starting lineups. All of the arithmetic is local (utils/tradeFinder.js)
     * -- there are thousands of candidate packages and asking an AI to price
     * them would be slow, expensive and no more accurate than the lineup math
     * the app already does.
     */
    const runFinder = async () => {
        if (!isPremium) { setShowPremiumModal(true); return; }
        setFinder({ status: 'loading', proposals: [], excluded: [], note: null });
        try {
            const leagueId = activeLeague?.sleeper_league_id;
            const [pData, lData, rData, nflState] = await Promise.all([
                loadPlayers(leagueId),
                getLeagueData(leagueId),
                getLeagueRosters(leagueId),
                getNflState(),
            ]);

            const slots = startingSlots(lData?.roster_positions || lData?.settings?.roster_positions || []);
            if (!slots.length) throw new Error("Couldn't read this league's starting lineup, so there's nothing to measure a trade against.");

            // Value is what a player is still worth THIS season, so the weeks
            // already played are not counted.
            const week = Number(nflState?.week || nflState?.display_week) || 1;
            const weeks = [];
            for (let w = week; w <= FANTASY_LAST_WEEK; w++) weeks.push(w);
            if (!weeks.length) weeks.push(week);
            const valueOf = makeRosValue(weeks);

            let rosters = rData?.rosters || {};
            let ownerIds = null;
            // Sleeper's /rosters carries no team name at all -- the names live
            // on /users, joined by owner_id (see utils/leaguePreview.js).
            if (!isYahooLeagueId(leagueId) && !isEspnLeagueId(leagueId)) {
                const users = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)
                    .then(r => (r.ok ? r.json() : []))
                    .catch(() => []);
                if (Array.isArray(users) && users.length) {
                    rosters = attachSleeperTeamNames(rosters, users);
                    ownerIds = sleeperOwnerIdsByName(users);
                }
            }

            const myRosterId = pickMyRosterId(rosters, activeLeague?.team_name, ownerIds);
            if (!myRosterId) throw new Error("Couldn't work out which team is yours in this league. Reconnect it from Add League and the finder will know who to trade for.");

            const playersById = pData?.players || {};
            const playersByName = pData?.playersByName || {};
            const platformMeta = rData?.yahooPlayersMeta || {};
            const toTeam = (id, roster) => ({
                rosterId: String(id),
                teamName: roster?.team_name || `Team ${id}`,
                players: resolveRosterPlayers(roster?.players, playersById, playersByName, platformMeta).players,
            });

            const meTeam = toTeam(myRosterId, rosters[myRosterId]);
            if (!meTeam.players.length) throw new Error('Your roster came back empty, so there is nothing to trade from.');

            const opponents = Object.entries(rosters)
                .filter(([id]) => String(id) !== String(myRosterId))
                .map(([id, roster]) => toTeam(id, roster))
                .filter(t => t.players.length);

            // Declared blocks only reorder what the lineup maths already
            // found -- see blockFit in utils/tradeFinder.js.
            const blocks = indexBlocksByRoster(rosters, blockClaims, leagueBlocks);

            // Your own declaration counts too -- leaving it out was why
            // editing your block appeared to do nothing.
            const result = findTrades({
                me: meTeam, opponents, slots, valueOf, limit: 12,
                blocks, myBlock: block, matchingOnly,
            });
            setFinder({ status: 'done', ...result, weeks: weeks.length, myTeam: meTeam.teamName, note: null });
        } catch (err) {
            console.error('Trade finder failed:', err);
            setFinder({ status: 'error', proposals: [], excluded: [], note: err.message });
        }
    };

    /** Drops a found trade into the grader so it can be written up properly. */
    const loadProposal = (proposal) => {
        const asAsset = (pl) => ({ ...pl, assetType: 'player', uniqueId: pl.player_id || pl.id });
        // Side A is always "me" in the grader, and in the finder what I GET is
        // what side A receives.
        setSideA(proposal.get.map(asAsset));
        setSideB(proposal.give.map(asAsset));
        setGradeResult(null);
        setUiErrorMessage(null);
        setMode('grade');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const formatAssetForPrompt = (asset) => {
        if (asset.assetType === 'pick') return `- ${asset.year} Round ${asset.round} Draft Pick`;
        const name = `${asset.fn || asset.first_name} ${asset.ln || asset.last_name}`;
        const team = asset.t || asset.team || 'FA';
        const position = asset.pos || asset.position || 'Unknown';
        // The dictionary's real injury designation ("Questionable"/"Out"/"IR")
        // lives on `injStatus`; `injury_status` was never a field this app
        // sets, so checking it first always fell straight through to the
        // generic roster `status` ("Active") and the AI never saw an injury.
        const status = asset.injStatus || asset.status || 'Active';
        
        // Injects the live current team and status explicitly into the list of assets
        return `- ${name} | Position: ${position} | CURRENT TEAM: ${team} | Status: ${status}`;
    };

    const runTradeEvaluation = async () => {
        // --- PAYWALL CHECK FIRES IMMEDIATELY ---
        if (!isPremium) {
            setShowPremiumModal(true);
            return;
        }

        if (sideA.length === 0 && sideB.length === 0) {
            alert("Please add assets to Side A or Side B first.");
            return;
        }

        setIsEvaluating(true);
        setGradeResult(null);
        setUiErrorMessage(null);

        const formatSideA = sideA.map(formatAssetForPrompt).join('\n');
        const formatSideB = sideB.map(formatAssetForPrompt).join('\n');

        const pipelinePrompt = `
            You are an expert NFL fantasy football analyst for a ${leagueType} format league. Evaluate this exact trade proposal.
            
            CRITICAL ROSTER OVERRIDE:
            Do not rely on historical training data for player teams, depth charts, or injury statuses. Treat the "CURRENT TEAM" and "Status" provided below as absolute, up-to-date facts for the ${new Date().getFullYear()} season. Base your evaluation strictly on this current context.

            SIDE A RECEIVES:
            ${formatSideA || '- Nothing'}

            SIDE B RECEIVES:
            ${formatSideB || '- Nothing'}

            YOUR TASK:
            1. Assess the value gained and lost by both sides based strictly on their CURRENT TEAMS provided above.
            2. Critically factor in the specific league format (${leagueType}). Draft picks hold massive weight in Dynasty, moderate in Keeper, and zero in Redraft.
            3. Assign a strict letter grade to both sides.
            4. Declare a winner or 'Even'.

            Return strictly in JSON format:
            {
                "gradeA": "Letter grade for Side A",
                "gradeB": "Letter grade for Side B",
                "winner": "State which side wins, or 'Even'",
                "analysis": "Detailed 4-5 sentence analysis explaining the grades based on the format and the players' current teams."
            }
        `;
        
        try {
            const response = await fetch('/api/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'trade', prompt: pipelinePrompt })
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({}));
                throw new Error(errJson.error || `Server API error ${response.status}`);
            }

            const data = await response.json();
            const rawResponseText = data.evaluation ? data.evaluation : JSON.stringify(data);
            setGradeResult(parseGraderResponse(rawResponseText));
            
        } catch (error) {
            console.error("Evaluation Error:", error);
            setUiErrorMessage(error.message || "Failed to process the evaluation pipeline.");
        } finally {
            setIsEvaluating(false);
        }
    };

    if (loading) return <div className={styles.loading}>Loading Engine...</div>;

    const currentYear = new Date().getFullYear();

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Trade Grader</h1>
                <p className={styles.subtitle}>Official Trade Valuation</p>
            </div>

            <div className={styles.modeTabs}>
                <button
                    className={`${styles.modeTab} ${mode === 'grade' ? styles.modeOn : ''}`}
                    onClick={() => setMode('grade')}
                >Grade</button>
                <button
                    className={`${styles.modeTab} ${mode === 'find' ? styles.modeOn : ''}`}
                    onClick={() => setMode('find')}
                >Find</button>
                <button
                    className={`${styles.modeTab} ${mode === 'block' ? styles.modeOn : ''}`}
                    onClick={() => setMode('block')}
                >Block</button>
            </div>

            {mode === 'block' && (
                <div className={styles.finderPane}>
                    <p className={styles.finderIntro}>
                        Say what you&rsquo;d move and what you&rsquo;re after. Your leaguemates see it,
                        and the finder lifts trades that line up <strong>both ways</strong> &mdash;
                        somebody wanting what you&rsquo;d send, and offering what you want back. Half a
                        match is half a trade, so it doesn&rsquo;t count. It never invents a trade
                        either; it only reorders what the lineups already support.
                    </p>

                    <div className={styles.blockCard}>
                        <div className={styles.blockLabel}>I&rsquo;d move</div>
                        <div className={styles.chipRow}>
                            {BLOCK_POSITIONS.map(pos => (
                                <button
                                    key={pos}
                                    className={`${styles.chip} ${block.shopping.includes(pos) ? styles.chipOn : ''}`}
                                    onClick={() => toggleBlockPos('shopping', pos)}
                                >{pos}</button>
                            ))}
                        </div>

                        <div className={styles.blockLabel}>I need</div>
                        <div className={styles.chipRow}>
                            {BLOCK_POSITIONS.map(pos => (
                                <button
                                    key={pos}
                                    className={`${styles.chip} ${block.needs.includes(pos) ? styles.chipOn : ''}`}
                                    onClick={() => toggleBlockPos('needs', pos)}
                                >{pos}</button>
                            ))}
                        </div>

                        <div className={styles.blockLabel}>Anything else</div>
                        <textarea
                            className={styles.blockNote}
                            rows={3}
                            maxLength={280}
                            placeholder="Not moving my RB1. Open on anything else."
                            value={block.note}
                            onChange={(e) => { setBlock(p => ({ ...p, note: e.target.value })); setBlockState({ status: 'idle', message: null }); }}
                        />

                        <button
                            className={styles.evalButton}
                            style={{ marginTop: '16px' }}
                            onClick={saveBlock}
                            disabled={blockState.status === 'saving'}
                        >
                            {blockState.status === 'saving' ? 'Posting...' : 'Post to League'}
                        </button>
                        {blockState.message && (
                            <div className={blockState.status === 'error' ? styles.blockErr : styles.blockOk}>
                                {blockState.message}
                            </div>
                        )}
                    </div>

                    <div className={styles.finderMeta}>What your league has posted</div>
                    {postedBlocks.length === 0 ? (
                        <div className={styles.finderEmpty}>
                            Nobody has posted a block yet. The finder works without one &mdash;
                            this only changes the order things show up in.
                        </div>
                    ) : (
                        postedBlocks.map(b => (
                            <div className={styles.postedBlock} key={b.user_id}>
                                <div className={styles.postedWho}>
                                    {b.teamName}
                                    {b.isMine && <span className={styles.postedMine}>You</span>}
                                </div>
                                <div className={styles.postedRow}>
                                    <span className={styles.postedLabel}>Moving</span>
                                    <span>{b.shopping?.length ? b.shopping.join(', ') : '--'}</span>
                                </div>
                                <div className={styles.postedRow}>
                                    <span className={styles.postedLabel}>Needs</span>
                                    <span>{b.needs?.length ? b.needs.join(', ') : '--'}</span>
                                </div>
                                {b.note && <div className={styles.postedNote}>&ldquo;{b.note}&rdquo;</div>}
                            </div>
                        ))
                    )}
                </div>
            )}

            {mode === 'find' && (
                <div className={styles.finderPane}>
                    <p className={styles.finderIntro}>
                        Every other roster in your league, searched for swaps that make
                        <strong> both </strong> starting lineups better. Worked out from
                        rest-of-season projections and your league&rsquo;s own lineup slots &mdash;
                        so a running back you never start is priced at what he&rsquo;s worth to
                        you, not what he&rsquo;s worth in the abstract.
                    </p>

                    {leagueType === 'Dynasty' && (
                        <div className={styles.finderWarn}>
                            This league is set to <strong>Dynasty</strong>. The finder prices
                            rest-of-season points only &mdash; it cannot value youth or draft
                            picks, so read these as win-now ideas rather than dynasty advice.
                        </div>
                    )}

                    <div className={styles.actionContainer}>
                        <button
                            className={`${styles.evalButton} ${finder.status === 'loading' ? styles.analyzing : ''}`}
                            onClick={runFinder}
                            disabled={finder.status === 'loading'}
                        >
                            {finder.status === 'loading' ? (
                                <><i className={`material-icons ${styles.spin}`}>autorenew</i> Searching Rosters...</>
                            ) : (
                                <><i className="material-icons">travel_explore</i> Find Trades</>
                            )}
                        </button>
                    </div>

                    {(leagueBlocks.length > 0 || block.shopping.length > 0 || block.needs.length > 0) && (
                        <label className={styles.onlyToggle}>
                            <input
                                type="checkbox"
                                checked={matchingOnly}
                                onChange={(e) => { setMatchingOnly(e.target.checked); setFinder({ status: 'idle', proposals: [], excluded: [], note: null }); }}
                            />
                            Only trades both sides asked for
                        </label>
                    )}

                    {finder.status === 'error' && (
                        <div className={styles.errorBox}>
                            <div className={styles.errorHeader}>
                                <i className="material-icons">error_outline</i> Couldn&rsquo;t search
                            </div>
                            <p>{finder.note}</p>
                        </div>
                    )}

                    {finder.status === 'done' && finder.proposals.length === 0 && (
                        <div className={styles.finderEmpty}>
                            {matchingOnly
                                ? 'No trade lines up with the blocks both ways right now \u2014 that needs somebody wanting what you\u2019d send AND offering what you want back. Untick the filter to see every trade that helps both lineups.'
                                : 'No trade here makes both lineups better right now. That is a real answer, not a failure \u2014 it usually means your roster is balanced against the rest of the league.'}
                        </div>
                    )}

                    {finder.status === 'done' && finder.proposals.length > 0 && (
                        <>
                            <div className={styles.finderMeta}>
                                {finder.considered.toLocaleString()} packages checked across{' '}
                                {finder.weeks} remaining week{finder.weeks === 1 ? '' : 's'}
                            </div>
                            {finder.proposals.map((proposal, i) => (
                                <div className={styles.proposal} key={`${proposal.rosterId}-${i}`}>
                                    <div className={styles.proposalHead}>
                                        <span className={styles.oppName}>vs {proposal.opponent}</span>
                                        <span className={styles.mutual}>
                                            Both gain {proposal.mutual.toFixed(1)}+ pts
                                        </span>
                                    </div>
                                    {proposal.fitReasons.length > 0 && (
                                        <div className={styles.fitNote}>
                                            <i className="material-icons">handshake</i>
                                            Both sides asked for this &mdash; {proposal.fitReasons.join(', ')}
                                        </div>
                                    )}
                                    <div className={styles.swap}>
                                        <div className={styles.swapSide}>
                                            <div className={styles.swapLabel}>You get</div>
                                            {proposal.get.map(pl => (
                                                <div className={styles.swapPlayer} key={pl.player_id || playerLabel(pl)}>
                                                    <span>{playerLabel(pl)}</span>
                                                    <span className={styles.swapPos}>{pl.pos}</span>
                                                </div>
                                            ))}
                                            <div className={styles.swapGain}>+{proposal.gainMe.toFixed(1)} your lineup</div>
                                        </div>
                                        <div className={styles.swapSide}>
                                            <div className={styles.swapLabel}>You give</div>
                                            {proposal.give.map(pl => (
                                                <div className={styles.swapPlayer} key={pl.player_id || playerLabel(pl)}>
                                                    <span>{playerLabel(pl)}</span>
                                                    <span className={styles.swapPos}>{pl.pos}</span>
                                                </div>
                                            ))}
                                            <div className={styles.swapGain}>+{proposal.gainThem.toFixed(1)} their lineup</div>
                                        </div>
                                    </div>
                                    <button className={styles.proposalBtn} onClick={() => loadProposal(proposal)}>
                                        Grade this trade
                                    </button>
                                </div>
                            ))}
                        </>
                    )}

                    {/* Never silent about a player the projection feed doesn't
                        cover: scoring him zero is what would put a real starter
                        at the top of the give-away list. */}
                    {finder.status === 'done' && finder.excluded.length > 0 && (
                        <div className={styles.finderExcluded}>
                            <strong>{finder.excluded.length} player{finder.excluded.length === 1 ? '' : 's'} left out</strong> &mdash;
                            no projection data, so they can&rsquo;t be priced and were not offered
                            in either direction: {finder.excluded.slice(0, 8).map(e => e.player).join(', ')}
                            {finder.excluded.length > 8 ? ` and ${finder.excluded.length - 8} more` : ''}.
                        </div>
                    )}
                </div>
            )}

            {mode === 'grade' && (<>
            <div className={styles.controlsGrid}>
                <div className={styles.controlGroup}>
                    <label>Evaluation Format</label>
                    <select className={styles.dropdown} value={leagueType} onChange={(e) => { setLeagueType(e.target.value); setGradeResult(null); }}>
                        <option value="Dynasty">Dynasty (Picks hold max value)</option>
                        <option value="Keeper">Keeper (Picks hold moderate value)</option>
                        <option value="Redraft">Redraft (Picks hold zero value)</option>
                    </select>
                    {formatDetection.source === 'roster-carryover' && (
                        <p className={styles.formatHint}>
                            Detected from {formatDetection.sampleSize} team{formatDetection.sampleSize === 1 ? '' : 's'}' roster carryover from last season. Change it above if that's wrong.
                        </p>
                    )}
                    {formatDetection.source === 'sleeper-settings' && (
                        <p className={styles.formatHint}>Detected from your league's own Sleeper settings.</p>
                    )}
                    {(formatDetection.source === 'no-prior-season' || formatDetection.source === 'no-comparable-rosters') && (
                        <p className={styles.formatHint}>Couldn't detect this automatically for a Yahoo league yet -- pick the right format above.</p>
                    )}
                </div>
            </div>

            <div className={styles.arena}>
                {/* SIDE A */}
                <div className={styles.tradeCard}>
                    <h2 className={styles.sideTitle}>Side A Receives</h2>
                    <div className={styles.assetList}>
                        {sideA.map(asset => (
                            <div key={asset.uniqueId} className={styles.assetItem}>
                                {asset.assetType === 'pick' ? (
                                    <>
                                        <div className={styles.pickIcon}>R{asset.round}</div>
                                        <div className={styles.assetMeta}>
                                            <span className={styles.assetName}>{asset.year} Draft Pick</span>
                                            <span className={styles.assetPos}>Round {asset.round}</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <img src={getAvatar(asset)} className={styles.assetImg} alt="" onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }} />
                                        <div className={styles.assetMeta}>
                                            <span className={styles.assetName}>{asset.fn || asset.first_name} {asset.ln || asset.last_name}</span>
                                            <span className={styles.assetPos}>{asset.pos || asset.position} • {asset.t || asset.team || 'FA'}</span>
                                        </div>
                                    </>
                                )}
                                <button className={styles.removeBtn} onClick={() => handleRemoveAsset('A', asset.uniqueId)}>
                                    <i className="material-icons">close</i>
                                </button>
                            </div>
                        ))}
                        
                        <div className={styles.addActions}>
                            <button className={styles.addAssetBtn} onClick={() => setIsSearchOpen('A')}>+ Add Player</button>
                            <button className={styles.addAssetBtn} onClick={() => setIsPickModalOpen('A')}>+ Add Pick</button>
                        </div>
                    </div>
                    {gradeResult && <div className={styles.gradeCircle}>{gradeResult.gradeA}</div>}
                </div>

                {/* SIDE B */}
                <div className={styles.tradeCard}>
                    <h2 className={styles.sideTitle}>Side B Receives</h2>
                    <div className={styles.assetList}>
                        {sideB.map(asset => (
                            <div key={asset.uniqueId} className={styles.assetItem}>
                                {asset.assetType === 'pick' ? (
                                    <>
                                        <div className={styles.pickIcon}>R{asset.round}</div>
                                        <div className={styles.assetMeta}>
                                            <span className={styles.assetName}>{asset.year} Draft Pick</span>
                                            <span className={styles.assetPos}>Round {asset.round}</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <img src={getAvatar(asset)} className={styles.assetImg} alt="" onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }} />
                                        <div className={styles.assetMeta}>
                                            <span className={styles.assetName}>{asset.fn || asset.first_name} {asset.ln || asset.last_name}</span>
                                            <span className={styles.assetPos}>{asset.pos || asset.position} • {asset.t || asset.team || 'FA'}</span>
                                        </div>
                                    </>
                                )}
                                <button className={styles.removeBtn} onClick={() => handleRemoveAsset('B', asset.uniqueId)}>
                                    <i className="material-icons">close</i>
                                </button>
                            </div>
                        ))}
                        
                        <div className={styles.addActions}>
                            <button className={styles.addAssetBtn} onClick={() => setIsSearchOpen('B')}>+ Add Player</button>
                            <button className={styles.addAssetBtn} onClick={() => setIsPickModalOpen('B')}>+ Add Pick</button>
                        </div>
                    </div>
                    {gradeResult && <div className={styles.gradeCircle}>{gradeResult.gradeB}</div>}
                </div>
            </div>

            <div className={styles.actionContainer}>
                <button 
                    className={`${styles.evalButton} ${isEvaluating ? styles.analyzing : ''}`} 
                    onClick={runTradeEvaluation} 
                    disabled={isEvaluating}
                >
                    {isEvaluating ? (
                        <><i className={`material-icons ${styles.spin}`}>autorenew</i> Compiling Report...</>
                    ) : (
                        <><i className="material-icons">psychology</i> Generate Grade</>
                    )}
                </button>

                {(sideA.length > 0 || sideB.length > 0 || gradeResult) && !isEvaluating && (
                    <button className={styles.clearTradeBtn} onClick={handleClearTrade}>
                        <i className="material-icons">delete_sweep</i> Clear Trade
                    </button>
                )}
            </div>

            {uiErrorMessage && (
                <div className={styles.errorBox}>
                    <div className={styles.errorHeader}>
                        <i className="material-icons">error_outline</i> SYSTEM ERROR
                    </div>
                    <p>{uiErrorMessage}</p>
                </div>
            )}

            {gradeResult && !isEvaluating && !uiErrorMessage && (
                <div className={styles.verdictCard}>
                    <h3 className={styles.verdictWinner}>Winner: {gradeResult.winner}</h3>
                    <p className={styles.verdictAnalysis}>{gradeResult.analysis}</p>
                </div>
            )}

            </>
            )}

            {/* PLAYER SEARCH MODAL */}
            {isSearchOpen && (
                <div className={styles.searchOverlay} onClick={() => setIsSearchOpen(null)}>
                    <div className={styles.searchModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>Add Player to Side {isSearchOpen}</h2>
                            <button className={styles.closeModalBtn} onClick={() => setIsSearchOpen(null)}>
                                <i className="material-icons">close</i>
                            </button>
                        </div>
                        <div className={styles.searchInputWrapper}>
                            <i className="material-icons">search</i>
                            <input type="text" placeholder="Search active NFL player..." className={styles.searchInput} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
                        </div>
                        <div className={styles.searchResults}>
                            {searchResults.length > 0 ? (
                                searchResults.map(p => (
                                    <div key={p.player_id || p.id} className={styles.searchRow} onClick={() => handleAddPlayer(p)}>
                                        <img src={getAvatar(p)} className={styles.searchAvatar} alt="" onError={(e) => { e.target.onerror = null; e.target.src = 'https://sleepercdn.com/images/v2/icons/player_default.webp'; }} />
                                        <div className={styles.searchMeta}>
                                            <span className={styles.searchName}>{p.fn || p.first_name} {p.ln || p.last_name}</span>
                                            <span className={styles.searchTeam}>{p.pos || p.position} • {p.t || p.team || 'NFL'}</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                searchQuery && <div className={styles.noResults}>No players found matching "{searchQuery}".</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* DRAFT PICK MODAL */}
            {isPickModalOpen && (
                <div className={styles.searchOverlay} onClick={() => setIsPickModalOpen(null)}>
                    <div className={styles.pickModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2>Add Pick to Side {isPickModalOpen}</h2>
                            <button className={styles.closeModalBtn} onClick={() => setIsPickModalOpen(null)}>
                                <i className="material-icons">close</i>
                            </button>
                        </div>
                        <div className={styles.pickControls}>
                            <div className={styles.controlGroup}>
                                <label>Draft Year</label>
                                <select className={styles.dropdown} value={pickYear} onChange={(e) => setPickYear(parseInt(e.target.value))}>
                                    {[0, 1, 2, 3].map(offset => (
                                        <option key={currentYear + offset} value={currentYear + offset}>{currentYear + offset}</option>
                                    ))}
                                </select>
                            </div>
                            <div className={styles.controlGroup}>
                                <label>Draft Round</label>
                                <select className={styles.dropdown} value={pickRound} onChange={(e) => setPickRound(parseInt(e.target.value))}>
                                    {[1, 2, 3, 4, 5, 6, 7].map(r => (
                                        <option key={r} value={r}>Round {r}</option>
                                    ))}
                                </select>
                            </div>
                            <button className={styles.goldBtn} onClick={handleAddPick}>Append Pick</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}