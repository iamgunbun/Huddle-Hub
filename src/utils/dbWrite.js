// Did that write actually write?
//
// Supabase reports SUCCESS for an update that matched no rows: `error` is null
// and the statement was perfectly valid -- it simply changed nothing. That
// happens when the id doesn't exist, or when a row-level security policy filters
// the row out of this account's view. Checking only `error` is how a settings
// screen ends up saying "Saved!" while the database is untouched.
//
// The returned row count is the only real confirmation. Kept dependency-free so
// the three-way distinction is pinned down by tests rather than by reading it
// back off a live database.

/** @returns {{ok: boolean, message: string}} */
export const describeLeagueWrite = (error, rowCount) => {
    if (error) return { ok: false, message: `Couldn't save: ${error.message || 'database error'}.` };
    if (!rowCount) {
        return {
            ok: false,
            message: "Nothing was saved -- this account doesn't have permission to edit this league.",
        };
    }
    return { ok: true, message: 'Saved!' };
};

/**
 * Why a write that reported success actually changed nothing.
 *
 * "Permission denied" is true but useless on its own -- there are three very
 * different causes and they need three different fixes, so the caller looks up
 * which one it is (the row exists? is this account recorded as commissioner?)
 * and this turns that into something actionable. The third case is the one
 * worth naming out loud: everything on this side is correct and the database
 * simply has no policy allowing the update, which no amount of clicking Save
 * will ever fix.
 */
export const describeWriteRefusal = ({ leagueExists, isCommissioner }) => {
    if (!leagueExists) {
        return "Nothing was saved -- this league isn't in the database, so there's no row to update.";
    }
    if (!isCommissioner) {
        return "Nothing was saved -- your account isn't recorded as this league's commissioner, so the database refused the change.";
    }
    return "Nothing was saved -- your account IS recorded as commissioner, so the database is refusing the update itself. "
        + "The leagues table is missing its commissioner update policy: run supabase/schema-guards.sql.";
};
