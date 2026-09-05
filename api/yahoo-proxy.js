import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// A page load fires many of these requests in a short burst -- a matchups or
// players view alone is a dozen-plus proxy calls -- and Vercel commonly
// reuses the same warm lambda instance for a burst like that. Without this,
// every single one of those calls re-reads the same still-valid token row
// from Supabase before ever talking to Yahoo, which is a wasted database
// round trip stacked onto each request's latency. Cached per user, and only
// trusted until the token's own expiry -- refresh behavior below is
// unchanged, it just runs against this cache first.
const tokenCache = new Map();

// Yahoo's own token lifetime is roughly an hour; refreshing a little early
// avoids handing out a token that expires mid-flight to Yahoo.
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

// Resolves a usable access token for this user, preferring the in-process
// cache and only touching Supabase (and, if needed, Yahoo's token endpoint)
// when the cache is empty, expired, or explicitly bypassed after a 401.
const getAccessToken = async (userId, { bypassCache = false } = {}) => {
    if (!bypassCache) {
        const cached = tokenCache.get(userId);
        if (cached && Date.now() < cached.expiresAtMs - EXPIRY_SAFETY_MARGIN_MS) {
            return { accessToken: cached.accessToken };
        }
    }

    const { data: authData, error: authError } = await supabase
        .from('user_integrations')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'yahoo')
        .single();

    if (authError || !authData) {
        return { error: { status: 401, body: { error: 'Yahoo account not linked.' } } };
    }

    let accessToken = authData.access_token;
    let expiresAtMs = new Date(authData.expires_at).getTime();

    if (Date.now() >= expiresAtMs - EXPIRY_SAFETY_MARGIN_MS) {
        const credentials = Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64');

        const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                redirect_uri: process.env.YAHOO_REDIRECT_URI,
                refresh_token: authData.refresh_token
            })
        });

        if (!tokenResponse.ok) {
            const refreshErrorBody = await tokenResponse.text().catch(() => '');
            console.error(`Yahoo token refresh failed (HTTP ${tokenResponse.status}) for user ${userId}: ${refreshErrorBody}`);
            tokenCache.delete(userId);
            return {
                error: {
                    status: 401,
                    body: { error: "Failed to refresh Yahoo session.", yahooStatus: tokenResponse.status, yahooError: refreshErrorBody }
                }
            };
        }

        const tokenData = await tokenResponse.json();
        accessToken = tokenData.access_token;
        expiresAtMs = Date.now() + tokenData.expires_in * 1000;

        await supabase.from('user_integrations').update({
            access_token: accessToken,
            refresh_token: tokenData.refresh_token,
            expires_at: new Date(expiresAtMs).toISOString()
        }).eq('user_id', userId).eq('provider', 'yahoo');
    }

    tokenCache.set(userId, { accessToken, expiresAtMs });
    return { accessToken };
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // Guarantee the body is parsed regardless of the server framework
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        } else if (body instanceof Buffer) {
            try { body = JSON.parse(body.toString()); } catch (e) {}
        }

        const userId = body?.userId;
        const endpoint = body?.endpoint;

        if (!userId || !endpoint) {
            return res.status(400).json({ error: 'Missing userId or endpoint.', bodyReceived: req.body });
        }

        const tokenResult = await getAccessToken(userId);
        if (tokenResult.error) {
            return res.status(tokenResult.error.status).json(tokenResult.error.body);
        }

        const callYahoo = (accessToken) => fetch(`https://fantasysports.yahooapis.com/fantasy/v2/${endpoint}?format=json`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        let yahooResponse = await callYahoo(tokenResult.accessToken);

        // A cached token can go bad between requests (revoked, rotated by
        // another instance) without this instance's copy of its expiry ever
        // catching it. One bypass-and-retry self-heals that instead of
        // failing every call until the cache entry's original expiry passes.
        if (yahooResponse.status === 401) {
            tokenCache.delete(userId);
            const retryTokenResult = await getAccessToken(userId, { bypassCache: true });
            if (retryTokenResult.error) {
                return res.status(retryTokenResult.error.status).json(retryTokenResult.error.body);
            }
            yahooResponse = await callYahoo(retryTokenResult.accessToken);
        }

        if (!yahooResponse.ok) {
            const yahooErrorBody = await yahooResponse.text().catch(() => '');
            console.error(`Yahoo API error (HTTP ${yahooResponse.status}) for endpoint "${endpoint}": ${yahooErrorBody}`);
            return res.status(yahooResponse.status).json({
                error: `Yahoo returned status ${yahooResponse.status}`,
                endpoint,
                yahooError: yahooErrorBody
            });
        }

        const data = await yahooResponse.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("Yahoo Proxy Error:", error);
        return res.status(500).json({ error: 'Failed to securely fetch from Yahoo.' });
    }
}