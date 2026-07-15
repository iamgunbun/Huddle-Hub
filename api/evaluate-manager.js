import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // 1. Check if the environment variable is loaded
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Backend Error: The GEMINI_API_KEY is missing from your .env.local file or Vercel settings." });
  }

  const { managerId, leagueId, teamName } = req.body;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // --- STEP 1: FETCH SLEEPER DATA ---
    let currentLeagueId = leagueId;
    let foundRoster = null;
    let history = [];
    let year = new Date().getFullYear();

    try {
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
    } catch (sleeperErr) {
        throw new Error(`Sleeper API fetch failed: ${sleeperErr.message}`);
    }

    // --- STEP 2: GEMINI AI GENERATION ---
    // Disable safety thresholds to prevent fantasy football terminology from triggering blocks
    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];

    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        safetySettings,
        generationConfig: { responseMimeType: "application/json" } 
    });
    
    const prompt = history.length === 0 
      ? `Analyze a new manager named ${teamName} who has just joined a Dynasty Fantasy Football league. They have no historical roster data. Return a raw JSON object with exactly three keys: "strategy", "profile", "philosophy". Keep it welcoming and professional.`
      : `You are a Dynasty Fantasy Football Analyst. Evaluate manager: ${teamName}. History: ${JSON.stringify(history)}. Latest Roster: ${JSON.stringify(foundRoster?.starters)}. Return a raw JSON object with exactly three keys: "strategy", "profile", "philosophy". Do not use markdown blocks.`;

    const result = await model.generateContent(prompt);

    // Check if the response was completely blocked by Google
    if (!result.response.candidates || result.response.candidates.length === 0) {
        throw new Error(`Gemini blocked the response. Finish Reason: ${result.response.promptFeedback?.blockReason || "Unknown"}`);
    }

    const evaluation = result.response.text();
    res.status(200).json({ evaluation });

  } catch (error) {
    console.error("Backend Crash:", error);
    // Force the exact error to appear on the frontend
    res.status(500).json({ error: error.toString() });
  }
}