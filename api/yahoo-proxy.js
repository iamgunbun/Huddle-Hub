import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

        const { data: authData, error: authError } = await supabase
            .from('user_integrations')
            .select('*')
            .eq('user_id', userId)
            .eq('provider', 'yahoo')
            .single();

        if (authError || !authData) {
            return res.status(401).json({ error: 'Yahoo account not linked.' });
        }

        let accessToken = authData.access_token;

        // Auto-refresh token if expired
        if (new Date() >= new Date(authData.expires_at)) {
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
                return res.status(401).json({ error: "Failed to refresh Yahoo session." });
            }

            const tokenData = await tokenResponse.json();
            accessToken = tokenData.access_token;
            const newExpiration = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

            await supabase.from('user_integrations').update({
                access_token: accessToken,
                refresh_token: tokenData.refresh_token,
                expires_at: newExpiration
            }).eq('user_id', userId).eq('provider', 'yahoo');
        }

        // Fetch securely from Yahoo
        const yahooResponse = await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/${endpoint}?format=json`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!yahooResponse.ok) {
            return res.status(yahooResponse.status).json({ error: `Yahoo returned status ${yahooResponse.status}` });
        }

        const data = await yahooResponse.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("Yahoo Proxy Error:", error);
        return res.status(500).json({ error: 'Failed to securely fetch from Yahoo.' });
    }
}