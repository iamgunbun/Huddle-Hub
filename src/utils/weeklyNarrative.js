// The shape a stored Weekly Summary recap is actually read back in.
//
// WHY THIS EXISTS
// ---------------
// In league_weekly_summaries (supabase/schema-guards.sql), `stats` is a
// jsonb column and `narrative` is a TEXT one. api/weekly-summary.js writes
// both as plain objects, so Postgres stores the narrative as the JSON text
// of that object and hands it back as a string -- while stats comes back as
// a real object.
//
// Every `narrative?.headline`, `narrative?.fullEvaluation` and
// `narrative?.storyBurns` read in the app therefore evaluated to undefined.
// The recap page rendered its stat tiles with no prose under them and every
// story card rendered with no roast on it, which is the "there are still no
// roasts in the slideshow" report: the roasts were in the database the whole
// time, behind one layer of quoting. Nothing threw and nothing logged,
// because reading a property off a string is perfectly legal.
//
// Parsing here rather than at each call site means the column can be
// migrated to jsonb (schema-guards.sql has the statement) without breaking
// the rows written before it was, and without the components needing to know
// which kind of row they got.

/**
 * A narrative object, whatever form the row arrived in: an object (a jsonb
 * column, or an already-parsed one) passes through, a JSON string is parsed.
 * Returns null when there is nothing usable, which every consumer already
 * renders as "stats only".
 */
export const parseNarrative = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return Array.isArray(value) ? null : value;
    if (typeof value !== 'string') return null;

    try {
        const parsed = JSON.parse(value);
        // A JSON scalar ("hello", 42) is valid JSON but not a narrative, and
        // handing one back would put `undefined` on every field again --
        // exactly the bug this exists to fix.
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed;
    } catch {
        // Not JSON at all: nothing this endpoint writes looks like that, but
        // a row that does holds prose, and prose belongs in the long written
        // section rather than being dropped or blown up into the headline.
        return { fullEvaluation: value };
    }
};
