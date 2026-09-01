export default function handler(req, res) {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'Missing userId parameter.' });
    }
    
    const clientId = process.env.YAHOO_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.YAHOO_REDIRECT_URI);
    const state = encodeURIComponent(userId);
    
    const yahooAuthUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;
    
    res.redirect(yahooAuthUrl);
}