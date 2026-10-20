import assert from 'node:assert/strict';

// The narrative column is text while stats is jsonb, so a recap comes back
// with its prose still quoted. Reading a property off that string is legal
// JavaScript that silently yields undefined, so this failed in the only way
// that leaves no trace at all: no error, no log, just a recap page with no
// words on it and story cards with no roasts. These check the one function
// standing between that column and every component that reads it.
const { parseNarrative } = await import('../src/utils/weeklyNarrative.js');

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

// The real shape: exactly what PostgREST returns for the text column today.
const stored = JSON.stringify({
    headline: 'Week 6 Recap',
    fullEvaluation: 'Paragraph one.\n\nParagraph two.',
    storyBurns: { bottomFeeders: 'You are digging a hole under the league.' },
    week: 6,
});
const parsed = parseNarrative(stored);
check('a stored narrative string becomes an object', typeof parsed, 'object');
check('the headline is reachable again', parsed.headline, 'Week 6 Recap');
check('and the burns, which is the reported bug',
    parsed.storyBurns.bottomFeeders, 'You are digging a hole under the league.');
check('newlines inside the prose survive the round trip',
    parsed.fullEvaluation.split('\n\n').length, 2);
// This is what the components were doing, and why nothing ever threw.
check('reading a burn off the raw string yields undefined -- the bug',
    stored.storyBurns, undefined);

// After the column is migrated to jsonb, rows arrive already parsed. Both
// shapes have to work at once or the migration breaks every older row.
const asObject = { headline: 'Week 7 Recap', storyBurns: { luck: 'burn' } };
check('an object passes straight through', parseNarrative(asObject), asObject);
check('and is the same reference, not a copy', parseNarrative(asObject) === asObject, true);

// Degradation. Each of these must leave the page rendering its stats rather
// than throwing inside a render.
check('null yields null', parseNarrative(null), null);
check('undefined yields null', parseNarrative(undefined), null);
check('an empty string yields null', parseNarrative(''), null);
check('malformed JSON keeps the text as the written section',
    parseNarrative('{not json'), { fullEvaluation: '{not json' });
check('plain prose keeps the text as the written section',
    parseNarrative('The week was a disaster.'), { fullEvaluation: 'The week was a disaster.' });
// A JSON scalar parses successfully but is not a narrative -- returning it
// would put undefined back on every field, which is the original bug.
check('a quoted JSON string is not treated as a narrative', parseNarrative('"just a string"'), null);
check('a JSON number is not treated as a narrative', parseNarrative('42'), null);
check('JSON null is not treated as a narrative', parseNarrative('null'), null);
check('a JSON array is not treated as a narrative', parseNarrative('[1,2,3]'), null);
check('an array object is not treated as a narrative', parseNarrative([1, 2, 3]), null);
check('a number is not treated as a narrative', parseNarrative(42), null);

// A failed generation still writes a narrative, and the banner that says so
// has to survive the parse or a broken recap looks like a working one.
check('the generation-failed flag survives',
    parseNarrative(JSON.stringify({ headline: 'Week 6 Recap', generationFailed: 'Gemini timed out' })).generationFailed,
    'Gemini timed out');

console.log(`OK: ${checks} weekly-narrative checks passed`);
