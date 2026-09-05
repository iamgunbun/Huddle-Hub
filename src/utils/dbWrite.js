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
