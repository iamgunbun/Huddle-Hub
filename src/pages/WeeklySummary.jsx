import React, { useState, useEffect } from 'react';
import { useLeague } from '../context/LeagueContext';
import { supabase } from '../supabaseClient';
import BackButton from '../components/BackButton';
import styles from './WeeklySummary.module.css';

// Reads what api/weekly-summary.js already generated and stored -- this
// page never talks to Gemini, Sleeper or Yahoo itself, it just renders the
// shared row every Pro member of this league already has (RLS-gated by
// league membership; see supabase/schema-guards.sql section 6). Sleeper and
// Yahoo leagues only for now, matching that endpoint -- ESPN isn't
// generated yet, so an ESPN league simply has no rows here.
export default function WeeklySummary() {
    const { activeLeague, isPremium, setShowPremiumModal } = useLeague();
    const [loading, setLoading] = useState(true);
    const [summaries, setSummaries] = useState([]);
    const [selectedKey, setSelectedKey] = useState(null);

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!activeLeague?.id || !isPremium) {
                setLoading(false);
                return;
            }
            setLoading(true);
            const { data, error } = await supabase
                .from('league_weekly_summaries')
                .select('season, week, stats, narrative, generated_at')
                .eq('league_id', activeLeague.id)
                .order('season', { ascending: false })
                .order('week', { ascending: false });

            if (!isMounted) return;
            if (error) {
                console.error("Error loading weekly summaries:", error);
                setSummaries([]);
            } else {
                setSummaries(data || []);
                if (data?.length) setSelectedKey(`${data[0].season}:${data[0].week}`);
            }
            setLoading(false);
        };
        load();
        return () => { isMounted = false; };
    }, [activeLeague?.id, isPremium]);

    const selected = summaries.find(s => `${s.season}:${s.week}` === selectedKey);

    if (loading) return <div className={styles.loading}>Loading Weekly Summary...</div>;

    return (
        <div className={styles.container}>
            <BackButton />
            <div className={styles.header}>
                <i className="material-icons">auto_awesome</i>
                <h1 className={styles.title}>Weekly Summary</h1>
                <img src="/pro-banner.png" alt="PRO" className={styles.proBadge} />
            </div>

            {!isPremium ? (
                <div className={styles.lockCard}>
                    <i className="material-icons">lock</i>
                    <h4>Weekly League Recaps</h4>
                    <p>
                        Every Tuesday, Huddle Pro members get an AI-written recap of their league's week --
                        every blowout, close call, position MVP, disappointment, and rivalry matchup, plus a
                        summary of the week's trades and waiver moves. Delivered by email and right here in the app.
                    </p>
                    <button className={styles.upgradeBtn} onClick={() => setShowPremiumModal(true)}>
                        Upgrade to Pro
                    </button>
                </div>
            ) : summaries.length === 0 ? (
                <div className={styles.lockCard}>
                    <i className="material-icons">event_available</i>
                    <h4>Nothing here yet</h4>
                    <p>
                        Your first Weekly Summary lands here (and in your inbox) after this week's games wrap up.
                        Recaps are generated every Tuesday.
                    </p>
                </div>
            ) : (
                <>
                    <select
                        className={styles.weekDropdown}
                        value={selectedKey || ''}
                        onChange={(e) => setSelectedKey(e.target.value)}
                    >
                        {summaries.map(s => (
                            <option key={`${s.season}:${s.week}`} value={`${s.season}:${s.week}`}>
                                {s.season} &middot; Week {s.week}
                            </option>
                        ))}
                    </select>

                    {selected && (
                        <div className={styles.recapCard}>
                            <h2 className={styles.headline}>{selected.narrative?.headline}</h2>

                            <div className={styles.statRow}>
                                {selected.stats?.blowout && (
                                    <div className={styles.statTile}>
                                        <div className={styles.statLabel}>Biggest Blowout</div>
                                        <div className={styles.statValue}>{selected.stats.blowout.winner}</div>
                                        <div className={styles.statSub}>won by {selected.stats.blowout.margin} pts</div>
                                    </div>
                                )}
                                {selected.stats?.closestCall && (
                                    <div className={styles.statTile}>
                                        <div className={styles.statLabel}>Closest Call</div>
                                        <div className={styles.statValue}>{selected.stats.closestCall.teamA} vs {selected.stats.closestCall.teamB}</div>
                                        <div className={styles.statSub}>decided by {selected.stats.closestCall.margin} pts</div>
                                    </div>
                                )}
                                {selected.stats?.rivalry && (
                                    <div className={styles.statTile}>
                                        <div className={styles.statLabel}>Rivalry Watch</div>
                                        <div className={styles.statValue}>{selected.stats.rivalry.teamA} vs {selected.stats.rivalry.teamB}</div>
                                        <div className={styles.statSub}>records {selected.stats.rivalry.recordGap} game(s) apart</div>
                                    </div>
                                )}
                            </div>

                            {[
                                ['Matchup Recap', selected.narrative?.matchupRecap],
                                ['MVP Spotlight', selected.narrative?.mvpSpotlight],
                                ['Disappointment of the Week', selected.narrative?.disappointmentOfTheWeek],
                                ['Rivalry Watch', selected.narrative?.rivalryWatch],
                                ['Waiver Wire Buzz', selected.narrative?.waiverWireBuzz],
                            ].map(([title, body]) => body && (
                                <div key={title} className={styles.section}>
                                    <h4 className={styles.sectionTitle}>{title}</h4>
                                    <p className={styles.sectionBody}>{body}</p>
                                </div>
                            ))}

                            {selected.stats?.mvpByPosition && (
                                <div className={styles.section}>
                                    <h4 className={styles.sectionTitle}>Position MVPs</h4>
                                    <div className={styles.mvpGrid}>
                                        {Object.entries(selected.stats.mvpByPosition).map(([pos, p]) => (
                                            <div key={pos} className={styles.mvpTile}>
                                                <div className={styles.mvpPos}>{pos}</div>
                                                <div className={styles.mvpName}>{p.name}</div>
                                                <div className={styles.mvpPts}>{p.actual} pts</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
