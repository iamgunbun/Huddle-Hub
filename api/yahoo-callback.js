import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    const { code, state } = req.query;

    if (!code) {
        return res.status(400).json({ error: "Missing authorization code from Yahoo OAuth pipeline." });
    }

    try {
        const credentials = Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64');
        
        const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                redirect_uri: process.env.YAHOO_REDIRECT_URI,
                code: code
            })
        });

        if (!tokenResponse.ok) {
            const errData = await tokenResponse.json();
            throw new Error(errData.error_description || "Failed token validation exchange loop.");
        }

        const tokenData = await tokenResponse.json();
        const expirationDate = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
        const targetUserId = state;

        const { error: dbError } = await supabase
            .from('user_integrations')
            .upsert({
                user_id: targetUserId,
                provider: 'yahoo',
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: expirationDate,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,provider' });

        if (dbError) throw dbError;

        res.redirect('/add-league?linked=yahoo');

    } catch (error) {
        console.error("Yahoo OAuth Protocol Failure:", error);
        res.redirect('/add-league?integration=failed&reason=' + encodeURIComponent(error.message));
    }
}