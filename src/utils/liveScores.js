// Whether the week currently on screen is the one being played right now.
//
// A past or future week's matchup data doesn't change no matter how often
// it's re-fetched, so polling only makes sense while the viewer is actually
// looking at the live week -- during the regular season, or during the
// playoffs, whichever the real NFL state (not any one league's own guess at
// the week) currently says is in progress.
export const isViewingLiveWeek = (nflState, viewedWeek) => {
    if (!nflState || viewedWeek === null || viewedWeek === undefined) return false;
    if (nflState.season_type !== 'regular' && nflState.season_type !== 'post') return false;

    const liveWeek = nflState.display_week || nflState.week;
    if (!liveWeek) return false;

    const viewed = parseInt(viewedWeek);
    return Number.isFinite(viewed) && viewed === parseInt(liveWeek);
};

// How often a live week's scores are re-fetched while someone is looking at
// them. Sleeper's own client polls on roughly this cadence during games;
// fast enough to feel real-time, spaced out enough not to hammer either
// platform's API (or, for Yahoo, the proxy's per-call Supabase/Yahoo round
// trip) once every viewer's tab is doing this at once.
export const LIVE_SCORE_POLL_MS = 30000;
