// Yahoo league scoring -> Sleeper stat-key scoring.
//
// Yahoo's league settings response describes its own scoring in two parts:
//   stat_categories.stats -> what each stat_id MEANS (name, display_name, position_type)
//   stat_modifiers.stats  -> how many points each stat_id is worth in THIS league
//
// Reading the categories at runtime means we never hardcode Yahoo's numeric
// stat ids (which differ per sport and have changed over time) -- we map on the
// human-readable name Yahoo itself supplies. That also means kicker and defense
// scoring comes through automatically for whatever categories a league enables.

const normalizeName = (value) =>
    String(value || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();

// Yahoo stat name -> the stat key Sleeper's projections/stats feeds use.
// Split by position type because Yahoo reuses names across positions (a QB's
// "Interceptions" thrown is not a defense's "Interception" caught).
const OFFENSE_NAMES = {
    'passing yards': 'pass_yd',
    'passing touchdowns': 'pass_td',
    'interceptions': 'pass_int',
    'passing interceptions': 'pass_int',
    'passing attempts': 'pass_att',
    'passing completions': 'pass_cmp',
    'completions': 'pass_cmp',
    'incomplete passes': 'pass_inc',
    'sacked': 'pass_sack',
    'rushing attempts': 'rush_att',
    'rushing yards': 'rush_yd',
    'rushing touchdowns': 'rush_td',
    'receptions': 'rec',
    'reception yards': 'rec_yd',
    'receiving yards': 'rec_yd',
    'reception touchdowns': 'rec_td',
    'receiving touchdowns': 'rec_td',
    'targets': 'rec_tgt',
    'return yards': 'return_yd',
    'return touchdowns': 'return_td',
    'kickoff return touchdowns': 'kr_td',
    'punt return touchdowns': 'pr_td',
    'fumbles': 'fum',
    'fumbles lost': 'fum_lost',
    'offensive fumble return td': 'fum_rec_td',
    'fumble recovery touchdowns': 'fum_rec_td',
};

const KICKER_NAMES = {
    'field goals 0 19 yards': 'fgm_0_19',
    'field goals 20 29 yards': 'fgm_20_29',
    'field goals 30 39 yards': 'fgm_30_39',
    'field goals 40 49 yards': 'fgm_40_49',
    'field goals 50+ yards': 'fgm_50p',
    'field goals 50 yards': 'fgm_50p',
    'field goals missed 0 19 yards': 'fgmiss_0_19',
    'field goals missed 20 29 yards': 'fgmiss_20_29',
    'field goals missed 30 39 yards': 'fgmiss_30_39',
    'field goals missed 40 49 yards': 'fgmiss_40_49',
    'field goals missed 50+ yards': 'fgmiss_50p',
    'field goals missed': 'fgmiss',
    'field goals made': 'fgm',
    'point after attempt made': 'xpm',
    'point after attempt missed': 'xpmiss',
    'extra point made': 'xpm',
    'extra point missed': 'xpmiss',
};

const DEFENSE_NAMES = {
    'sack': 'sack',
    'sacks': 'sack',
    'interception': 'int',
    'interceptions': 'int',
    'fumble recovery': 'fum_rec',
    'fumbles recovered': 'fum_rec',
    'forced fumbles': 'ff',
    'touchdown': 'def_td',
    'touchdowns': 'def_td',
    'defensive touchdowns': 'def_td',
    'safety': 'safe',
    'safeties': 'safe',
    'block kick': 'blk_kick',
    'blocked kick': 'blk_kick',
    'kickoff and punt return touchdowns': 'def_st_td',
    'return touchdowns': 'def_st_td',
    'extra point returned': 'def_st_td',
    'points allowed 0 points': 'pts_allow_0',
    'points allowed 1 6 points': 'pts_allow_1_6',
    'points allowed 7 13 points': 'pts_allow_7_13',
    'points allowed 14 20 points': 'pts_allow_14_20',
    'points allowed 21 27 points': 'pts_allow_21_27',
    'points allowed 28 34 points': 'pts_allow_28_34',
    'points allowed 35+ points': 'pts_allow_35p',
};

// Yahoo marks defense/special-teams categories with position_type "DT" and
// kickers with "K"; everything else is offense.
const mapNameForPosition = (name, positionType) => {
    const key = normalizeName(name);
    const type = String(positionType || '').toUpperCase();
    if (type === 'DT') return DEFENSE_NAMES[key] || null;
    if (type === 'K') return KICKER_NAMES[key] || null;
    return OFFENSE_NAMES[key] || KICKER_NAMES[key] || null;
};

// Yahoo collections arrive either as a real array or as an object with numeric
// keys plus a "count" field.
const toEntries = (node) => {
    if (!node) return [];
    if (Array.isArray(node)) return node;
    if (typeof node !== 'object') return [];
    return Object.keys(node).filter(k => k !== 'count').map(k => node[k]);
};

const unwrapStat = (entry) => entry?.stat || entry || null;

/**
 * Builds a Sleeper-shaped scoring_settings object from a Yahoo league's
 * settings payload, using Yahoo's own stat_categories to resolve stat ids.
 */
export const buildYahooScoringSettings = (settingsData) => {
    const scoring = {};

    const idToKey = {};
    toEntries(settingsData?.stat_categories?.stats).forEach(entry => {
        const stat = unwrapStat(entry);
        if (!stat || stat.stat_id === undefined) return;
        // position_type can be a bare string or a nested list of types.
        const positionType = stat.position_type
            || stat.position_types?.position_type
            || (Array.isArray(stat.position_types) ? stat.position_types[0]?.position_type : null);
        const mapped = mapNameForPosition(stat.name || stat.display_name, positionType);
        if (mapped) idToKey[String(stat.stat_id)] = mapped;
    });

    toEntries(settingsData?.stat_modifiers?.stats).forEach(entry => {
        const stat = unwrapStat(entry);
        if (!stat || stat.stat_id === undefined) return;
        const key = idToKey[String(stat.stat_id)];
        if (!key) return;
        const value = parseFloat(stat.value);
        if (!Number.isNaN(value)) scoring[key] = value;
    });

    return scoring;
};

// Points-allowed is scored in tiers, so a projected points-allowed figure has to
// be placed in its bucket rather than multiplied.
const PTS_ALLOW_BUCKETS = [
    { key: 'pts_allow_0', max: 0 },
    { key: 'pts_allow_1_6', max: 6 },
    { key: 'pts_allow_7_13', max: 13 },
    { key: 'pts_allow_14_20', max: 20 },
    { key: 'pts_allow_21_27', max: 27 },
    { key: 'pts_allow_28_34', max: 34 },
    { key: 'pts_allow_35p', max: Infinity },
];

const FG_BUCKET_KEYS = ['fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50p'];

// Keys handled by dedicated bucket logic below rather than a flat multiply.
const BUCKET_KEYS = new Set([...PTS_ALLOW_BUCKETS.map(b => b.key)]);

/**
 * Scores a projected/actual stat line against a scoring_settings map.
 * Returns null when the stat line carries none of the league's scored stats,
 * so callers can fall back rather than reporting a misleading 0.
 */
export const scoreStatLine = (stats, scoringSettings, playerPos) => {
    if (!stats || !scoringSettings) return null;

    let points = 0;
    let matched = false;

    for (const [key, multiplier] of Object.entries(scoringSettings)) {
        if (BUCKET_KEYS.has(key)) continue;
        const value = stats[key];
        if (typeof value === 'number' && !Number.isNaN(value)) {
            points += value * multiplier;
            matched = true;
        }
    }

    // Defense: place projected points-allowed into its scoring tier.
    const hasPtsAllowTiers = PTS_ALLOW_BUCKETS.some(b => scoringSettings[b.key] !== undefined);
    if (hasPtsAllowTiers) {
        const allowed = typeof stats.pts_allow === 'number' ? stats.pts_allow : null;
        if (allowed !== null) {
            const bucket = PTS_ALLOW_BUCKETS.find(b => allowed <= b.max);
            const tierValue = bucket ? scoringSettings[bucket.key] : undefined;
            if (typeof tierValue === 'number') {
                points += tierValue;
                matched = true;
            }
        }
    }

    // Kickers: leagues score field goals by distance, but a projection may only
    // carry a total made figure. Fall back to the average of the league's own
    // distance values so the kicker isn't silently worth zero.
    const fgTierValues = FG_BUCKET_KEYS
        .map(k => scoringSettings[k])
        .filter(v => typeof v === 'number');
    const hasFgTierStats = FG_BUCKET_KEYS.some(k => typeof stats[k] === 'number');
    if (fgTierValues.length && !hasFgTierStats && typeof stats.fgm === 'number') {
        const avg = fgTierValues.reduce((t, v) => t + v, 0) / fgTierValues.length;
        points += stats.fgm * avg;
        matched = true;
    }

    if (playerPos === 'TE' && scoringSettings.bonus_rec_te && typeof stats.rec === 'number') {
        points += stats.rec * scoringSettings.bonus_rec_te;
    }

    return matched ? points : null;
};
