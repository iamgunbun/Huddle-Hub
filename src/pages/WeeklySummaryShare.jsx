import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import WeeklySummaryRecap from '../components/WeeklySummaryRecap';
import styles from './WeeklySummaryShare.module.css';

// A public, no-login-required view of one already-generated recap -- what a
// Pro member's Share button (WeeklySummary.jsx) hands a leaguemate. Reads
// through api/weekly-summary.js's ?share=1 mode (plain fetch, no Supabase
// client/session involved) rather than querying Supabase directly, since
// league_weekly_summaries' RLS requires a real signed-in session that a
// logged-out visitor never has -- see the handlePublicShare comment in
// api/weekly-summary.js for the full reasoning.
export default function WeeklySummaryShare() {
    const { leagueId, season, week } = useParams();
    const [state, setState] = useState({ loading: true, data: null, error: null });

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            try {
                const res = await fetch(`/api/weekly-summary?share=1&leagueId=${encodeURIComponent(leagueId)}&season=${encodeURIComponent(season)}&week=${encodeURIComponent(week)}`);
                const body = await res.json().catch(() => ({}));
                if (!isMounted) return;
                if (!res.ok) {
                    setState({ loading: false, data: null, error: body?.error || 'This summary could not be found.' });
                    return;
                }
                setState({ loading: false, data: body, error: null });
            } catch {
                if (isMounted) setState({ loading: false, data: null, error: 'This summary could not be found.' });
            }
        };
        load();
        return () => { isMounted = false; };
    }, [leagueId, season, week]);

    return (
        <div className={styles.page}>
            <div className={styles.container}>
                <Link to="/" className={styles.brand}>
                    <img src="/mobile.png" alt="Huddle Hub" className={styles.brandLogo} />
                    <span>HUDDLE HUB</span>
                </Link>

                {state.loading && <div className={styles.status}>Loading recap...</div>}

                {!state.loading && state.error && (
                    <div className={styles.status}>
                        <i className="material-icons">error_outline</i>
                        <p>{state.error}</p>
                    </div>
                )}

                {!state.loading && state.data && (
                    <>
                        <div className={styles.leagueHeader}>
                            <div className={styles.leagueName}>{state.data.leagueName}</div>
                            <div className={styles.weekLabel}>{state.data.season} &middot; Week {state.data.week}</div>
                        </div>
                        <WeeklySummaryRecap stats={state.data.stats} narrative={state.data.narrative} />
                    </>
                )}

                <div className={styles.cta}>
                    <p>Get the weekly recap for your own league.</p>
                    <Link to="/login" className={styles.ctaBtn}>Try Huddle Hub</Link>
                </div>
            </div>
        </div>
    );
}
