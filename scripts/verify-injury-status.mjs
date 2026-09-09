import assert from 'node:assert/strict';
import { getPlayerInjuryInfo } from '../src/utils/injuryStatus.js';

let checks = 0;
const check = (name, actual, expected) => {
    try {
        assert.deepEqual(actual, expected);
        checks++;
    } catch (err) {
        console.error(`FAIL: ${name}`);
        throw err;
    }
};

// --- healthy players produce no badge ---
check('no injStatus at all -> null', getPlayerInjuryInfo({ injStatus: null }), null);
check('an empty string -> null', getPlayerInjuryInfo({ injStatus: '' }), null);
check('a missing player object -> null', getPlayerInjuryInfo(undefined), null);

// --- known designations, case-insensitively ---
check('Questionable', getPlayerInjuryInfo({ injStatus: 'Questionable' }), { code: 'Q', label: 'Questionable', tone: 'caution', reason: null });
check('Doubtful', getPlayerInjuryInfo({ injStatus: 'Doubtful' }), { code: 'D', label: 'Doubtful', tone: 'warning', reason: null });
check('Out', getPlayerInjuryInfo({ injStatus: 'Out' }), { code: 'O', label: 'Out', tone: 'danger', reason: null });
check('IR, lowercase', getPlayerInjuryInfo({ injStatus: 'ir' }), { code: 'IR', label: 'Injured Reserve', tone: 'danger', reason: null });
check('Suspended', getPlayerInjuryInfo({ injStatus: 'Suspended' }), { code: 'SUS', label: 'Suspended', tone: 'danger', reason: null });
check('Sleeper\'s own short "Sus" code', getPlayerInjuryInfo({ injStatus: 'Sus' }), { code: 'SUS', label: 'Suspended', tone: 'danger', reason: null });

// --- reason travels along when the platform actually gave one ---
check('a real reason is carried through', getPlayerInjuryInfo({ injStatus: 'Questionable', injNotes: 'Knee' }), { code: 'Q', label: 'Questionable', tone: 'caution', reason: 'Knee' });
check('no reason available -> null, never invented', getPlayerInjuryInfo({ injStatus: 'Out', injNotes: null }), { code: 'O', label: 'Out', tone: 'danger', reason: null });

// --- an unrecognized designation is still shown, not swallowed ---
check('an unmapped status is shown verbatim rather than hidden', getPlayerInjuryInfo({ injStatus: 'Personal' }), { code: 'PERSONAL', label: 'Personal', tone: 'danger', reason: null });

console.log(`OK: ${checks} injury-status checks passed`);
