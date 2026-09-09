// Turning a player's weekly injury designation into something the UI can
// show consistently everywhere a player appears (Matchups, My Team, the
// Players page, the player modal).
//
// The designation lives on `injStatus` (set from Sleeper's own
// `injury_status` in loadPlayers -- see src/utils/helperFunctions/players.js
// -- and populated the same way for a Yahoo/ESPN league's fallback metadata
// too). Several call sites have separately, wrongly reached for
// `inj_status`/`injury_status` instead over time; those fields are never
// actually set on a player object, so the check always failed silently and
// the badge never showed. Centralizing the read here, once, is what keeps
// that bug from creeping back in a fifth place.
const STATUS_INFO = {
    questionable: { code: 'Q', label: 'Questionable', tone: 'caution' },
    doubtful: { code: 'D', label: 'Doubtful', tone: 'warning' },
    out: { code: 'O', label: 'Out', tone: 'danger' },
    ir: { code: 'IR', label: 'Injured Reserve', tone: 'danger' },
    'injured reserve': { code: 'IR', label: 'Injured Reserve', tone: 'danger' },
    pup: { code: 'PUP', label: 'Physically Unable to Perform', tone: 'danger' },
    sus: { code: 'SUS', label: 'Suspended', tone: 'danger' },
    suspended: { code: 'SUS', label: 'Suspended', tone: 'danger' },
    na: { code: 'NA', label: 'Not Active', tone: 'danger' },
    cov: { code: 'COV', label: 'COVID-19', tone: 'warning' },
};

/**
 * `{ code, label, tone, reason }` for a player with a real weekly injury
 * designation, or null for a healthy/active player. `reason` (Sleeper's
 * `injury_notes` -- a body part or short note like "Knee" or "Not injury
 * related - Personal") is only ever real text pulled from the platform,
 * never guessed: a player with a status but no captured reason gets `reason:
 * null`, which callers should render as nothing rather than inventing one.
 */
export const getPlayerInjuryInfo = (player) => {
    const raw = player?.injStatus;
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const known = STATUS_INFO[trimmed.toLowerCase()];
    return {
        code: known?.code || trimmed.toUpperCase(),
        label: known?.label || trimmed,
        tone: known?.tone || 'danger',
        reason: player?.injNotes || null,
    };
};
