import assert from 'node:assert/strict';
import { runWithConcurrency } from '../src/utils/concurrency.js';

let checks = 0;
const check = (name, fn) => {
    try {
        fn();
        checks++;
    } catch (err) {
        console.error(`FAIL: ${name}`);
        throw err;
    }
};

const test = async (name, fn) => {
    try {
        await fn();
        checks++;
    } catch (err) {
        console.error(`FAIL: ${name}`);
        throw err;
    }
};

await test('preserves input order regardless of completion order', async () => {
    const delays = [30, 10, 20, 5, 25];
    const results = await runWithConcurrency(delays, 2, (ms, idx) => new Promise(resolve => {
        setTimeout(() => resolve(idx), ms);
    }));
    assert.deepEqual(results, [0, 1, 2, 3, 4]);
});

await test('never runs more than `limit` workers at once', async () => {
    let active = 0;
    let maxActive = 0;
    const items = new Array(9).fill(0);
    await runWithConcurrency(items, 3, async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
    });
    assert.ok(maxActive <= 3, `expected max 3 concurrent, saw ${maxActive}`);
    assert.equal(maxActive, 3, 'should actually reach the concurrency limit, not just respect it');
});

await test('empty input resolves to an empty array without calling the worker', async () => {
    let called = false;
    const results = await runWithConcurrency([], 3, async () => { called = true; });
    assert.deepEqual(results, []);
    assert.equal(called, false);
});

await test('limit larger than the item count still runs every item exactly once', async () => {
    const seen = [];
    await runWithConcurrency(['a', 'b'], 10, async (item) => { seen.push(item); });
    assert.deepEqual(seen.sort(), ['a', 'b']);
});

await test('a worker rejection propagates out of runWithConcurrency', async () => {
    await assert.rejects(
        runWithConcurrency([1, 2, 3], 2, async (n) => {
            if (n === 2) throw new Error('boom');
            return n;
        }),
        /boom/
    );
});

console.log(`OK: ${checks} concurrency checks passed`);
