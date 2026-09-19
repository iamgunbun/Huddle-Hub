import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './WeeklySummaryStory.module.css';

const SLIDE_MS = 6000;

// Builds the slide run for one week's recap. Only slides whose underlying
// data actually exists are included -- a week with no trades or no bench
// blunder just gets a shorter story rather than a slide apologising for
// itself.
const buildSlides = ({ stats, narrative, leagueName, week, season }) => {
    const slides = [];
    const burns = narrative?.storyBurns || {};

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
            meta: `League average was ${stats.scoringContext.average}`,
            sub: burns.highScore,
            tone: 'gold',
        });
    }

    if (stats?.blowout) {
        // The blowout is a matchup, so it has to name the team on the
        // wrong end of it -- "won by 53" with no opponent is half a story.
        const loser = stats.blowout.winner === stats.blowout.teamA ? stats.blowout.teamB : stats.blowout.teamA;
        const winnerScore = stats.blowout.winner === stats.blowout.teamA ? stats.blowout.scoreA : stats.blowout.scoreB;
        const loserScore = stats.blowout.winner === stats.blowout.teamA ? stats.blowout.scoreB : stats.blowout.scoreA;
        slides.push({
            key: 'blowout',
            kicker: 'Biggest blowout',
            headline: stats.blowout.winner,
            versus: stats.blowout.winner ? `beat ${loser}` : null,
            stat: stats.blowout.margin,
            statLabel: 'point win',
            meta: stats.blowout.winner ? `${winnerScore} — ${loserScore}` : null,
            sub: burns.blowout,
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
            meta: `${stats.closestCall.scoreA} — ${stats.closestCall.scoreB}`,
            sub: burns.closestCall,
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
            sub: burns.mvps,
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
            meta: `Benched ${worstBench.benched} (${worstBench.benchedPoints}) to start ${worstBench.started} (${worstBench.startedPoints})`,
            sub: burns.benchDisaster,
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
            meta: `Projected ${stats.biggestDisappointment.projected}, scored ${stats.biggestDisappointment.actual}`,
            sub: burns.disappointment,
            tone: 'red',
        });
    }

    if (stats?.luckWatch?.unluckiestLoss) {
        const unlucky = stats.luckWatch.unluckiestLoss;
        slides.push({
            key: 'luck',
            kicker: 'Unluckiest loss',
            headline: unlucky.team,
            versus: `lost to ${unlucky.lostTo}`,
            stat: unlucky.score,
            statLabel: 'points — and still lost',
            meta: `${unlucky.lostTo} put up ${unlucky.opponentScore}`,
            sub: burns.luck,
            tone: 'blue',
        });
    }

    if (stats?.powerRankings?.length) {
        slides.push({
            key: 'power',
            kicker: 'Power rankings',
            headline: 'Where everyone stands',
            rankings: stats.powerRankings.slice(0, 5),
            sub: burns.powerRankings,
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

            <div className={`${styles.slide} ${styles[slide.tone] || ''}`} key={slide.key}>
                <div className={styles.kicker}>{slide.kicker}</div>
                <div className={styles.headline}>{slide.headline}</div>
                {slide.versus && <div className={styles.versus}>{slide.versus}</div>}

                {slide.stat !== undefined && (
                    <div className={styles.statBlock}>
                        <div className={styles.statValue}><StoryNumber value={slide.stat} /></div>
                        <div className={styles.statLabel}>{slide.statLabel}</div>
                    </div>
                )}

                {slide.meta && <div className={styles.meta}>{slide.meta}</div>}

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

            {/* Tap zones sit ABOVE the slide content (which is purely
                visual and takes no pointer events of its own), so a tap
                anywhere on the card advances rather than landing on the
                text and doing nothing. Press-and-hold pauses, the way a
                stories feed does. */}
            <div className={styles.navZones}>
                <button
                    className={styles.navPrev}
                    onClick={prev}
                    onPointerDown={() => setPaused(true)}
                    onPointerUp={() => setPaused(false)}
                    onPointerCancel={() => setPaused(false)}
                    onPointerLeave={() => setPaused(false)}
                    aria-label="Previous slide"
                />
                <button
                    className={styles.navNext}
                    onClick={next}
                    onPointerDown={() => setPaused(true)}
                    onPointerUp={() => setPaused(false)}
                    onPointerCancel={() => setPaused(false)}
                    onPointerLeave={() => setPaused(false)}
                    aria-label="Next slide"
                />
            </div>

            <div className={styles.footer}>
                <span className={styles.tapHint}>Tap to skip ahead</span>
                <button className={styles.skipBtn} onClick={onClose}>Skip to full recap</button>
            </div>
        </div>
    );
}
