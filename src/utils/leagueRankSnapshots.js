// Shared, server-side storage for the power rankings' week-over-week
// "moved up/down" history -- see supabase/schema-guards.sql section 4.
//
// This used to live in the viewing browser's own localStorage, which meant
// two different league members (or the same person on two devices) could see
// different movement numbers for the identical league on the identical day,
// purely because each browser's own history was its own private copy. One row
// per league per week, shared by every viewer, is what makes the number mean
// the same thing to whoever is looking at it.
//
// `leagueId` here is always the Supabase `leagues.id` (a UUID) -- the same id
// every other commissioner/settings write in this app uses -- not the
// platform's own league id (sleeper_league_id), which is a Sleeper/Yahoo/ESPN
// concept the database doesn't key this table on.

import { supabase } from '../supabaseClient';

/**
 * Every recorded weekly order for this league, in the {week: rosterId[]}
 * shape movementFromSnapshots (rankMovement.js) expects.
 *
 * Fails soft to {} -- not an error -- for a league whose database hasn't been
 * migrated yet (the table or its policies from schema-guards.sql aren't
 * there), so a missing migration shows every team as "Newly ranked" instead
 * of breaking the whole panel.
 */
export const readLeagueRankSnapshots = async (leagueId) => {
    if (!leagueId) return {};

    try {
        const { data, error } = await supabase
            .from('league_rank_snapshots')
            .select('week, roster_order')
            .eq('league_id', leagueId);

        if (error || !Array.isArray(data)) return {};

        const snapshots = {};
        data.forEach(row => {
            if (Number.isFinite(row.week) && Array.isArray(row.roster_order)) {
                snapshots[row.week] = row.roster_order;
            }
        });
        return snapshots;
    } catch (e) {
        console.warn("Couldn't read the shared power-ranking history:", e);
        return {};
    }
};

/**
 * Records this week's order for every viewer, not just this browser.
 *
 * Any league member may write this (see the RLS policy's own reasoning): the
 * value is a deterministic computed snapshot of the same underlying league
 * data, not a setting one member could misrepresent to the others, so there
 * is no single writer to designate -- whoever's browser loads the rankings
 * first in a given week is the one that records it. Upserted on (league_id,
 * week) so a later viewer refreshing the same week updates it rather than
 * erroring or duplicating the row.
 */
export const writeLeagueRankSnapshot = async (leagueId, week, order) => {
    if (!leagueId || !Number.isFinite(week)) return;

    try {
        const { error } = await supabase
            .from('league_rank_snapshots')
            .upsert(
                { league_id: leagueId, week, roster_order: order || [], updated_at: new Date().toISOString() },
                { onConflict: 'league_id,week' }
            );

        if (error) console.warn("Couldn't record this week's power ranking order:", error);
    } catch (e) {
        console.warn("Couldn't record this week's power ranking order:", e);
    }
};
