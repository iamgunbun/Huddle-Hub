import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { managerId, leagueId, teamName } = req.body;

  try {
    // 1. Fetch historical data from Sleeper
    const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
    const leagueData = await leagueRes.json();
    
    let currentLeagueId = leagueId;
    let foundRoster = null;
    let history = [];
    let year = leagueData.season;

    while (currentLeagueId && currentLeagueId !== "0" && currentLeagueId !== 0) {
      const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeagueId}/rosters`);
      if (!rostersRes.ok) break;
      const rosters = await rostersRes.json();
      const roster = rosters.find(r => r.owner_id === managerId || (r.co_owners && r.co_owners.includes(managerId)));
      
      if (roster) {
        history.push({ year, wins: roster.settings?.wins, losses: roster.settings?.losses });
        if (!foundRoster) foundRoster = roster;
      }

      const lRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeagueId}`);
      if (!lRes.ok) break;
      const lData = await lRes.json();
      currentLeagueId = lData.previous_league_id;
      year = lData.season;
    }

    // 2. Prepare the Prompt for Gemini
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" } // Force JSON output
    });
    
    const prompt = history.length === 0 
      ? `Analyze a new manager named ${teamName} who has just joined a Dynasty Fantasy Football league. They have no historical roster data. Return a raw JSON object with exactly three keys: "strategy", "profile", "philosophy". Keep it welcoming and professional.`
      : `You are a Dynasty Fantasy Football Analyst. Evaluate manager: ${teamName}.
History: ${JSON.stringify(history)}.
Latest Roster Snapshot: ${JSON.stringify(foundRoster?.starters)}.

You MUST return your response as a raw JSON object with the following three keys exactly:
{
  "strategy": "A 1-2 sentence evaluation of their current roster composition (e.g. Win-Now, Rebuilding, Aging core).",
  "profile": "A 1-2 sentence summary of their overall dynasty performance and history.",
  "philosophy": "A 1-2 sentence prediction on their trading style and roster management habits."
}`;

    // 3. Call Gemini
    const result = await model.generateContent(prompt);
    const evaluation = result.response.text();

    res.status(200).json({ evaluation });
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: "Failed to evaluate manager" });
  }
}