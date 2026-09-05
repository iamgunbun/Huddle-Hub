// Telling the AI draft grader how much NFL experience a drafted player
// actually had AT THE TIME of the pick being evaluated.
//
// The shared player dictionary's `exp`/`years_exp` field is the player's real
// experience as of right now (whenever the dictionary was last refreshed) --
// not as of whatever season's draft is being reviewed. Left unstated, the
// model falls back on its own training-data associations for "is this player
// a rookie", which go stale the moment a season passes: a 2025 rookie is
// still very often described as a rookie a year later, and a since-broken-out
// player's draft-day "late-round value" label doesn't get revisited either.
// Computing the real number and saying so explicitly closes both gaps with a
// fact instead of a guess.

export const ORDINAL_SUFFIXES = { 1: 'st', 2: 'nd', 3: 'rd' };

export const ordinal = (n) => {
    const num = Math.trunc(n);
    const mod100 = num % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
    return `${num}${ORDINAL_SUFFIXES[num % 10] || 'th'}`;
};

/**
 * `currentExp`: the player's real years of NFL experience right now (from the
 * player dictionary). `yearsSinceDraft`: how many NFL seasons have elapsed
 * between the draft being reviewed and now (0 if reviewing this season's own
 * draft). Returns a short, factual label for that pick's experience level at
 * the moment it was made -- or null when there's no real experience figure to
 * reason from at all, rather than guessing.
 */
export const describeExperienceAtDraft = (currentExp, yearsSinceDraft) => {
    if (typeof currentExp !== 'number' || Number.isNaN(currentExp)) return null;
    const elapsed = typeof yearsSinceDraft === 'number' && yearsSinceDraft > 0 ? yearsSinceDraft : 0;
    const expAtDraft = Math.max(0, currentExp - elapsed);

    if (expAtDraft === 0) return 'a rookie at the time of this pick';
    return `entering their ${ordinal(expAtDraft + 1)} NFL season at the time of this pick`;
};
