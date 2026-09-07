// Saving commissioner settings, and knowing whether they actually saved.
//
// The trap here: Supabase reports SUCCESS for an update that matched no rows.
// `error` is null and the statement is perfectly valid -- it simply changed
// nothing. That happens when the id doesn't exist, or when a row-level security
// policy filters the row out of this account's view. Checking only `error` means
// the page says "Saved!" while the database is untouched, which is exactly how a
// settings screen ends up appearing to work and never persisting anything.
//
// The returned row count is the only real confirmation, so every write here asks
// for the rows back and treats an empty result as a failure.

import { supabase } from '../supabaseClient';
import { describeLeagueWrite, describeWriteRefusal } from './dbWrite';

/**
 * Works out WHY an update matched no rows.
 *
 * Reads are allowed to any signed-in account while updates are restricted to
 * the commissioner, and that asymmetry is exactly what makes this knowable: if
 * the row can still be read back after the update changed nothing, the row is
 * there and it's the update that was refused. Pair that with whether this
 * account is actually recorded as commissioner and the three causes separate
 * cleanly.
 */
const diagnoseLeagueWriteRefusal = async (leagueId) => {
    const [{ data: leagueRow }, { data: sessionData }] = await Promise.all([
        supabase.from('leagues').select('id').eq('id', leagueId).maybeSingle(),
        supabase.auth.getSession(),
    ]);

    const userId = sessionData?.session?.user?.id;
    let isCommissioner = false;
    if (userId) {
        const { data: membership } = await supabase
            .from('user_leagues')
            .select('is_commissioner')
            .eq('user_id', userId)
            .eq('league_id', leagueId)
            .maybeSingle();
        isCommissioner = !!membership?.is_commissioner;
    }

    return { leagueExists: !!leagueRow, isCommissioner };
};

/** Applies a patch to the league row, and reports whether it truly landed. */
export const updateLeagueSettings = async (leagueId, patch) => {
    if (!leagueId) return { ok: false, message: 'No league selected.' };

    const { data, error } = await supabase
        .from('leagues')
        .update(patch)
        .eq('id', leagueId)
        .select('id');

    const result = describeLeagueWrite(error, data?.length || 0);
    if (result.ok) return result;

    if (error) {
        console.warn('League settings write failed:', { leagueId, patch, error });
        return result;
    }

    // Reported success, changed nothing. Say which of the three causes it was
    // instead of a flat "no permission", which is true of all of them and
    // actionable for none.
    const facts = await diagnoseLeagueWriteRefusal(leagueId).catch(() => null);
    console.warn('League settings write did not persist:', { leagueId, patch, ...(facts || {}) });
    return facts ? { ok: false, message: describeWriteRefusal(facts) } : result;
};
