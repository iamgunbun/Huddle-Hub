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
import { describeLeagueWrite } from './dbWrite';

/** Applies a patch to the league row, and reports whether it truly landed. */
export const updateLeagueSettings = async (leagueId, patch) => {
    if (!leagueId) return { ok: false, message: 'No league selected.' };

    const { data, error } = await supabase
        .from('leagues')
        .update(patch)
        .eq('id', leagueId)
        .select('id');

    const result = describeLeagueWrite(error, data?.length || 0);
    if (!result.ok) console.warn('League settings write did not persist:', { leagueId, patch, error });
    return result;
};
