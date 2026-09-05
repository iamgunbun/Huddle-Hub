// Runs `worker` over `items` with at most `limit` calls in flight at once.
//
// Yahoo's proxy has a history of intermittent 400s under a full burst of
// parallel calls (see yahooService.js), which is why several fetch loops were
// made fully sequential -- one request, wait for it, then the next. That is
// correct but slow: a 10-team league's per-team player points, for example,
// serialize into a chain of round trips instead of overlapping any of them.
// A small bounded pool keeps only a few requests in flight at once (below
// whatever burst size was tripping Yahoo up) while still overlapping enough
// of them to cut real wall-clock time.
export const runWithConcurrency = async (items, limit, worker) => {
    const list = items || [];
    const results = new Array(list.length);
    if (!list.length) return results;

    const size = Math.max(1, Math.min(limit || 1, list.length));
    let nextIndex = 0;

    const runners = new Array(size).fill(null).map(async () => {
        while (nextIndex < list.length) {
            const current = nextIndex++;
            results[current] = await worker(list[current], current);
        }
    });

    await Promise.all(runners);
    return results;
};
