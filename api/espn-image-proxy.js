// api/espn-image-proxy.js
//
// A private ESPN league's custom team logos can require the viewer's own
// ESPN session to load, the same way the league/roster JSON itself does --
// which is why a public league's logos load fine directly from the browser
// while a private league's blink and fail: the browser has no ESPN cookies
// of its own for this app's domain to send along with a plain <img> request.
// This fetches the image server-side with this account's stored espn_s2/SWID
// cookies attached (same lookup espn-proxy.js already does for the JSON
// data) and streams the bytes back from this app's own origin instead.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// This fetches whatever host it's given server-side, so restricting it to
// ESPN's own image hosts is what stands between this and an open SSRF proxy.
// Two hosts, not one: espncdn.com serves the stock mascot/helmet art
// (logoType VECTOR); a manager's own uploaded logo (logoType CUSTOM_UPLOAD)
// is served from mystique-api.fantasy.espn.com instead -- see isEspnCdnUrl
// in espnParsers.js, which this must stay in sync with.
const isAllowedEspnImageHost = (hostname) =>
    hostname === 'espncdn.com' || hostname.endsWith('.espncdn.com')
    || hostname === 'fantasy.espn.com' || hostname.endsWith('.fantasy.espn.com');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { url, userId } = req.query;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Missing url' });
        }

        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return res.status(400).json({ error: 'Invalid url' });
        }

        if (parsed.protocol !== 'https:' || !isAllowedEspnImageHost(parsed.hostname)) {
            return res.status(400).json({ error: 'URL not allowed' });
        }

        const headers = {};
        if (userId) {
            const { data: stored } = await supabase
                .from('user_integrations')
                .select('access_token, refresh_token')
                .eq('user_id', userId)
                .eq('provider', 'espn')
                .maybeSingle();

            if (stored?.access_token && stored?.refresh_token) {
                headers['Cookie'] = `espn_s2=${stored.access_token}; SWID=${stored.refresh_token};`;
            }
        }

        const response = await fetch(parsed.toString(), { headers });
        if (!response.ok) {
            return res.status(response.status).end();
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        const buffer = Buffer.from(await response.arrayBuffer());

        res.setHeader('Content-Type', contentType);
        // This endpoint's whole purpose is to sit in an <img src>, so it needs
        // to behave like a normal cacheable image request -- team logos rarely
        // change, but shouldn't be cached forever either.
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        return res.status(200).send(buffer);
    } catch (error) {
        console.error("ESPN Image Proxy Error:", error);
        return res.status(500).end();
    }
}
