import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './WeeklySummaryStory.module.css';

const SLIDE_MS = 6000;

// Builds the slide run for one week's recap. Only slides whose underlying
// data actually exists are included -- a week with no trades or no bench
// blunder just gets a shorter story rather than a slide apologising for
// itself.
const buildSlides = ({ stats, narrative, leagueName, week, season }) => {
    const slides = [];

    slides.push({
        key: 'intro',
        kicker: leagueName,
        headline: `Week ${week} is in the books`,
        sub: narrative?.headline || `${season} season`,
        tone: 'gold',
    });

    if (stats?.scoringContext?.highest) {
        slides.push({
            key: 'high',
            kicker: 'Highest score of the week',
            headline: stats.scoringContext.highest.team,
            stat: stats.scoringContext.highest.score,
            statLabel: 'points',
            sub: `League average was ${stats.scoringContext.average}`,
            tone: 'gold',
        });
    }

    if (stats?.blowout) {
        slides.push({
            key: 'blowout',
            kicker: 'Biggest blowout',
            headline: stats.blowout.winner,
            stat: stats.blowout.margin,
            statLabel: 'point win',
            sub: narrative?.matchupRecap,
            tone: 'gold',
        });
    }

    if (stats?.closestCall) {
        slides.push({
            key: 'closest',
            kicker: 'Closest call',
            headline: `${stats.closestCall.teamA} vs ${stats.closestCall.teamB}`,
            stat: stats.closestCall.margin,
            statLabel: 'points apart',
            tone: 'blue',
        });
    }

    const mvps = Object.entries(stats?.mvpByPosition || {});
    if (mvps.length) {
        slides.push({
            key: 'mvps',
            kicker: 'Position MVPs',
            headline: 'The best of the week',
            grid: mvps.map(([pos, p]) => ({ pos, name: p.name, pts: p.actual })),
            sub: narrative?.mvpSpotlight,
            tone: 'gold',
        });
    }

    const worstBench = stats?.benchCalls?.[0];
    if (worstBench) {
        slides.push({
            key: 'bench',
            kicker: 'Worst start/sit call',
            headline: worstBench.team,
            stat: worstBench.pointsLeft,
            statLabel: 'points left on the bench',
            sub: `Benched ${worstBench.benched} (${worstBench.benchedPoints}) and started ${worstBench.started} (${worstBench.startedPoints}).`,
            tone: 'red',
        });
    }

    if (stats?.biggestDisappointment) {
        slides.push({
            key: 'disappointment',
            kicker: 'Disappointment of the week',
            headline: stats.biggestDisappointment.team,
            stat: stats.biggestDisappointment.variance,
            statLabel: 'under projection',
            sub: narrative?.disappointmentOfTheWeek,
            tone: 'red',
        });
    }

    if (stats?.luckWatch?.unluckiestLoss) {
        slides.push({
            key: 'luck',
            kicker: 'Unluckiest loss',
            headline: stats.luckWatch.unluckiestLoss.team,
            stat: stats.luckWatch.unluckiestLoss.score,
            statLabel: `points — and still lost to ${stats.luckWatch.unluckiestLoss.lostTo}`,
            sub: narrative?.luckWatch,
            tone: 'blue',
        });
    }

    if (stats?.powerRankings?.length) {
        slides.push({
            key: 'power',
            kicker: 'Power rankings',
            headline: 'Where everyone stands',
            rankings: stats.powerRankings.slice(0, 5),
            tone: 'gold',
        });
    }

    slides.push({
        key: 'outro',
        kicker: 'That was Week ' + week,
        headline: 'The full breakdown is below',
        sub: 'Every matchup, every roast, every start/sit disaster.',
        tone: 'gold',
    });

    return slides;
};

// Counts a number up on each slide so the big reveals land instead of just
// appearing. Restarts whenever the displayed value changes (i.e. per slide).
const StoryNumber = ({ value }) => {
    const [display, setDisplay] = useState(0);
    const frameRef = useRef(null);

    useEffect(() => {
        const target = Number(value) || 0;
        const start = performance.now();
        const duration = 1000;
        const tick = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(target * eased);
            if (progress < 1) frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameRef.current);
    }, [value]);

    return <>{display.toFixed(1)}</>;
};

/**
 * The first-open "story" for a week's recap -- a full-screen, auto-advancing
 * sequence of the week's big reveals, in the style of a stories feed.
 *
 * Deliberately only the highlights: this is the theatrical pass, and the
 * page underneath it still carries the complete detail for anyone who wants
 * to actually read it. Every number shown here comes straight from the
 * already-computed stats, so the story can't say anything the recap doesn't.
 */
export default function WeeklySummaryStory({ stats, narrative, leagueName, week, season, onClose }) {
    const slides = useMemo(
        () => buildSlides({ stats, narrative, leagueName, week, season }),
        [stats, narrative, leagueName, week, season]
    );

    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);

    const next = useCallback(() => {
        setIndex(i => {
            if (i >= slides.length - 1) {
                onClose();
                return i;
            }
            return i + 1;
        });
    }, [slides.length, onClose]);

    const prev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

    useEffect(() => {
        if (paused) return undefined;
        const timer = setTimeout(next, SLIDE_MS);
        return () => clearTimeout(timer);
    }, [index, paused, next]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') next();
            if (e.key === 'ArrowLeft') prev();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [next, prev, onClose]);

    const slide = slides[index];
    if (!slide) return null;

    return (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Weekly summary story">
            <div className={styles.progressRow}>
                {slides.map((s, i) => (
                    <div key={s.key} className={styles.progressTrack}>
                        <div
                            className={`${styles.progressFill} ${i === index && !paused ? styles.progressActive : ''}`}
                            style={{
                                width: i < index ? '100%' : i === index ? undefined : '0%',
                                animationDuration: `${SLIDE_MS}ms`,
                            }}
                        />
                    </div>
                ))}
            </div>

            <button className={styles.closeBtn} onClick={onClose} aria-label="Close story">
                <i className="material-icons">close</i>
            </button>

            <div
                className={`${styles.slide} ${styles[slide.tone] || ''}`}
                key={slide.key}
                onPointerDown={() => setPaused(true)}
                onPointerUp={() => setPaused(false)}
                onPointerLeave={() => setPaused(false)}
            >
                <div className={styles.kicker}>{slide.kicker}</div>
                <div className={styles.headline}>{slide.headline}</div>

                {slide.stat !== undefined && (
                    <div className={styles.statBlock}>
                        <div className={styles.statValue}><StoryNumber value={slide.stat} /></div>
                        <div className={styles.statLabel}>{slide.statLabel}</div>
                    </div>
                )}

                {slide.grid && (
                    <div className={styles.mvpGrid}>
                        {slide.grid.map(g => (
                            <div key={g.pos} className={styles.mvpCard}>
                                <div className={styles.mvpPos}>{g.pos}</div>
                                <div className={styles.mvpName}>{g.name}</div>
                                <div className={styles.mvpPts}>{g.pts} pts</div>
                            </div>
                        ))}
                    </div>
                )}

                {slide.rankings && (
                    <div className={styles.rankList}>
                        {slide.rankings.map(r => (
                            <div key={r.rank} className={styles.rankRow}>
                                <span className={styles.rankNum}>{r.rank}</span>
                                <span className={styles.rankTeam}>{r.team}</span>
                                <span className={styles.rankRecord}>{r.wins}-{r.losses}</span>
                            </div>
                        ))}
                    </div>
                )}

                {slide.sub && <p className={styles.sub}>{slide.sub}</p>}
            </div>

            <div className={styles.navZones}>
                <button className={styles.navPrev} onClick={prev} aria-label="Previous slide" />
                <button className={styles.navNext} onClick={next} aria-label="Next slide" />
            </div>

            <button className={styles.skipBtn} onClick={onClose}>Skip to full recap</button>
        </div>
    );
}
