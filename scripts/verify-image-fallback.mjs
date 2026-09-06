import assert from 'node:assert/strict';
import { resolveImageSrc, onImageError } from '../src/utils/imageFallback.js';

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

check('an unknown url resolves to itself', resolveImageSrc('https://example.com/a.png', '/brand.png'), 'https://example.com/a.png');
check('a falsy src resolves straight to the fallback', resolveImageSrc(null, '/brand.png'), '/brand.png');
check('an empty string resolves to the fallback', resolveImageSrc('', '/brand.png'), '/brand.png');

// A mock <img> element -- just enough for onImageError to act on.
const mockImg = () => ({ onerror: () => {}, src: '' });

const badUrl = 'https://example.com/broken.png';
check('before any failure, the url is trusted', resolveImageSrc(badUrl, '/brand.png'), badUrl);

const el = mockImg();
onImageError(badUrl, '/brand.png')({ target: el });
check('onImageError swaps the element\'s src to the fallback', el.src, '/brand.png');
check('onImageError disarms itself so a fallback failure does not loop', el.onerror, null);

// The actual bug: a re-render (e.g. a live-score poll) hands the <img> the
// SAME broken src prop again. Without the module-level cache, this would
// render broken, then flip to fallback again on the next error -- forever.
check('once marked bad, later renders resolve straight to the fallback -- no more blink', resolveImageSrc(badUrl, '/brand.png'), '/brand.png');

// A different, still-good url is unaffected by another one having failed.
const goodUrl = 'https://example.com/fine.png';
check('marking one url bad does not affect a different url', resolveImageSrc(goodUrl, '/brand.png'), goodUrl);

const e2 = mockImg();
onImageError(null, '/brand.png')({ target: e2 });
check('a falsy src passed to onImageError does not throw, and still swaps to the fallback', e2.src, '/brand.png');

console.log(`OK: ${checks} image-fallback checks passed`);
