// A team/player logo that fails to load once will keep failing, but a plain
// `onError={(e) => e.target.src = fallback}` only patches the DOM node
// directly -- the next re-render (a live-score poll, a state update
// elsewhere on the page) hands the <img> the same broken `src` prop right
// back, so it flashes broken again before onError swaps it a second time.
// Over a page that polls every 30s, that reads as the image "blinking"
// forever instead of settling on the fallback.
//
// A module-level cache (not React state) remembers which URLs are known bad
// across every re-render and every component instance, so a URL that failed
// once renders as the fallback immediately from then on -- no more blinking,
// and no state plumbing needed in every page that shows one of these images.
const knownBadImageUrls = new Set();

/** The src to actually render: the fallback if this URL is already known bad. */
export const resolveImageSrc = (src, fallback) => (src && !knownBadImageUrls.has(src) ? src : fallback);

/** An onError handler that remembers `src` as bad and swaps the DOM node to `fallback`. */
export const onImageError = (src, fallback) => (e) => {
    if (src) knownBadImageUrls.add(src);
    e.target.onerror = null;
    e.target.src = fallback;
};
