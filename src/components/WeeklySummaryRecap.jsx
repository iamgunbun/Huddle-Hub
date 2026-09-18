import React, { useEffect, useRef, useState } from 'react';
import styles from './WeeklySummaryRecap.module.css';

// Counts a number up from 0 to its real value on mount -- purely a visual
// flourish, the final value rendered is always the real stat (never
// rounded/approximated differently than the plain number would be), so
// nothing here can make a number lie, only arrive with a little drama.
const CountUp = ({ value, decimals = 0, duration = 900, suffix = '' }) => {
    const [display, setDisplay] = useState(0);
    const frameRef = useRef(null);

    useEffect(() => {
        const target = Number(value) || 0;
        const start = performance.now();
        const tick = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            // Ease-out cubic -- fast start, gentle settle, reads as a real
            // counter winding down rather than a linear ticker.
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(target * eased);
            if (progress < 1) frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameRef.current);
    }, [value, duration]);

    return <>{display.toFixed(decimals)}{suffix}</>;
};

/**
 * The actual recap display -- stat tiles, narrative sections, position MVPs
 * -- shared between the authenticated Weekly Summary page and the public
 * share page (WeeklySummaryShare.jsx) so a leaguemate who opens a shared
 * link without an account sees the exact same recap a Pro member does, and
 * so the entrance animation only has to be built once.
 *
 * The staggered reveal plays every time this mounts (not just "the first
 * time ever") -- it's short and the point is drama when a recap first
 * loads on screen, not a one-shot gimmick that's gone if someone reopens
 * it to show a friend.
 */
export default function WeeklySummaryRecap({ stats, narrative }) {
    if (!stats && !narrative) return null;

    let delayIndex = 0;
    const nextDelay = () => {
        const d = delayIndex * 70;
        delayIndex += 1;
        return { animationDelay: `${d}ms` };
    };

    const sections = [
        ['Matchup Recap', narrative?.matchupRecap],
        ['MVP Spotlight', narrative?.mvpSpotlight],
        ['Disappointment of the Week', narrative?.disappointmentOfTheWeek],
        ['Rivalry Watch', narrative?.rivalryWatch],
        ['Waiver Wire Impact', narrative?.waiverWireBuzz],
        ['Next Week Preview', narrative?.nextWeekPreview],
    ];

    return (
        <div className={styles.recapCard}>
            <h2 className={styles.headline} style={nextDelay()}>{narrative?.headline}</h2>

            <div className={styles.statRow}>
                {stats?.blowout && (
                    <div className={styles.statTile} style={nextDelay()}>
                        <div className={styles.statLabel}>Biggest Blowout</div>
                        <div className={styles.statValue}>{stats.blowout.winner}</div>
                        <div className={styles.statSub}>won by <CountUp value={stats.blowout.margin} decimals={1} suffix=" pts" /></div>
                    </div>
                )}
                {stats?.closestCall && (
                    <div className={styles.statTile} style={nextDelay()}>
                        <div className={styles.statLabel}>Closest Call</div>
                        <div className={styles.statValue}>{stats.closestCall.teamA} vs {stats.closestCall.teamB}</div>
                        <div className={styles.statSub}>decided by <CountUp value={stats.closestCall.margin} decimals={1} suffix=" pts" /></div>
                    </div>
                )}
                {stats?.rivalry && (
                    <div className={styles.statTile} style={nextDelay()}>
                        <div className={styles.statLabel}>Rivalry Watch</div>
                        <div className={styles.statValue}>{stats.rivalry.teamA} vs {stats.rivalry.teamB}</div>
                        <div className={styles.statSub}>records {stats.rivalry.recordGap} game(s) apart</div>
                    </div>
                )}
            </div>

            {sections.map(([title, body]) => body && (
                <div key={title} className={styles.section} style={nextDelay()}>
                    <h4 className={styles.sectionTitle}>{title}</h4>
                    <p className={styles.sectionBody}>{body}</p>
                </div>
            ))}

            {stats?.mvpByPosition && Object.keys(stats.mvpByPosition).length > 0 && (
                <div className={styles.section} style={nextDelay()}>
                    <h4 className={styles.sectionTitle}>Position MVPs</h4>
                    <div className={styles.mvpGrid}>
                        {Object.entries(stats.mvpByPosition).map(([pos, p]) => (
                            <div key={pos} className={styles.mvpTile} style={nextDelay()}>
                                <div className={styles.mvpPos}>{pos}</div>
                                <div className={styles.mvpName}>{p.name}</div>
                                <div className={styles.mvpPts}><CountUp value={p.actual} decimals={1} suffix=" pts" /></div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
