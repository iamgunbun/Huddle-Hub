import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Backend Error: Missing Gemini API Key." });
  }

  const { managerId, leagueId, teamName, currentRosterPlayers } = req.body;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // --- STEP 1: FETCH SLEEPER HISTORICAL RECORDS ---
    let currentLeagueId = leagueId;
    let history = [];
    let year = new Date().getFullYear();

    try {
      while (currentLeagueId && currentLeagueId !== "0" && currentLeagueId !== 0) {
        const lRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeagueId}`);
        if (!lRes.ok) break;
        const lData = await lRes.json();
        const actualSeasonYear = lData.season;

        const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeagueId}/rosters`);
        if (!rostersRes.ok) break;
        const rosters = await rostersRes.json();
        const roster = rosters.find(r => r.owner_id === managerId || (r.co_owners && r.co_owners.includes(managerId)));
        
        if (rower) {
          const wins = roster.settings?.wins || 0;
          const losses = roster.settings?.losses || 0;
          
          if (wins > 0 || losses > 0) {
            history.push({ year: actualSeasonYear, wins, losses });
          }
        }
        currentLeagueId = lData.previous_league_id;
        year = lData.season;
      }
    } catch (sleeperErr) {
        console.error("Sleeper History Fetch Error:", sleeperErr);
    }

    // --- STEP 2: GEMINI COMPILATION ENGINE ---
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
    
    const currentYear = new Date().getFullYear();

    const prompt = history.length === 0 
      ? `Analyze a new manager named ${teamName} who has just joined a Dynasty Fantasy Football league. They have no historical roster data. Return a raw JSON object with exactly three keys: "strategy", "profile", "philosophy". Keep it welcoming and professional.`
      : `You are an expert Dynasty Fantasy Football Analyst. Evaluate manager: ${teamName}. 
      
      CRITICAL TIMELINE RULE: We are currently in the ${currentYear} pre-season. The ${currentYear} season has NOT started yet. Do not speak about the ${currentYear} season in the past tense.
      
      Completed Past Seasons Historical Performance Records:
      ${JSON.stringify(history)}
      
      ACTUAL CURRENT ROSTER OF PLAYERS FOR THE UPCOMING ${currentYear} SEASON:
      ${JSON.stringify(currentRosterPlayers)}
      
      CRITICAL ROSTER INTEGRITY RULE: You must ONLY evaluate the specific players listed in the current roster above. Do not invent, assume, or hallucinate any other players. If the list is empty, state they are currently clearing space or drafting.
      
      Return a raw JSON object with exactly three keys: "strategy", "profile", "philosophy". Do not use markdown blocks.`;

    const result = await model.generateContent(prompt);

    if (!result.response.candidates || result.response.candidates.length === 0) {
        throw new Error(`Gemini blocked the response.`);
    }

    const evaluation = result.response.text();
    res.status(200).json({ evaluation });

  } catch (error) {
    console.error("Backend Crash:", error);
    res.status(500).json({ error: error.toString() });
  }
}