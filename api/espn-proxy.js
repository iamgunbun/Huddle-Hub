// api/espn-proxy.js

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { leagueId, year, espnS2, swid } = req.body;

        if (!leagueId || !year) {
            return res.status(400).json({ error: 'Missing leagueId or year' });
        }

        const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=mSettings&view=mTeam&view=mRoster`;

        // The server can freely set custom cookie headers!
        const headers = {};
        if (espnS2 && swid) {
            headers['Cookie'] = `espn_s2=${espnS2}; SWID=${swid};`;
        }

        const response = await fetch(url, { headers });

        if (response.status === 401) {
            return res.status(401).json({ error: "Private ESPN League: Invalid or expired cookies." });
        }

        if (!response.ok) {
            return res.status(response.status).json({ error: `ESPN returned status ${response.status}` });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("ESPN Proxy Error:", error);
        return res.status(500).json({ error: 'Failed to securely fetch from ESPN.' });
    }
}