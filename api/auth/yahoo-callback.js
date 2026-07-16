import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    const { code, state } = req.query; // 'state' usually passes the logged-in user's custom UUID session

    if (!code) {
        return res.status(400).json({ error: "Missing authorization code from Yahoo OAuth pipeline." });
    }

    try {
        // 1. Construct the token exchange request payload
        const credentials = Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64');
        
        const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                redirect_uri: process.env.YAHOO_REDIRECT_URI, // Must match your app portal exactly
                code: code
            })
        });

        if (!tokenResponse.ok) {
            const errData = await tokenResponse.json();
            throw new Error(errData.error_description || "Failed token validation exchange loop.");
        }

        const tokenData = await tokenResponse.json();
        
        // Yahoo access tokens expire in exactly 3600 seconds (1 hour)
        const expirationDate = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

        // 2. Upsert the freshly minted tokens directly into your secure Supabase table
        // Note: You'll map 'state' to the true auth.uid() from your frontend session pass
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

        // 3. Bounce the user back to the main user profile or setting page screen safely
        res.redirect('/managers?integration=success');

    } catch (error) {
        console.error("Yahoo OAuth Protocol Failure:", error);
        res.redirect('/managers?integration=failed&reason=' + encodeURIComponent(error.message));
    }
}