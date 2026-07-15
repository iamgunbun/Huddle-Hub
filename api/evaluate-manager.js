import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Backend Error: Missing Gemini API Key." });
  }

  const { managerId, leagueId, teamName } = req.body;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // --- STEP 1: FETCH SLEEPER DATA ACCURATELY ---
    let currentLeagueId = leagueId;
    let foundRoster = null;
    let history = [];

    try {
      while (currentLeagueId && currentLeagueId !== "0" && currentLeagueId !== 0) {
        
        // 1. Fetch League Data FIRST to get the true season year
        const lRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeagueId}`);
        if (!lRes.ok) break;
        const lData = await lRes.json();
        const actualSeasonYear = lData.season;

        // 2. Fetch Roster Data
        const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeagueId}/rosters`);
        if (!rostersRes.ok) break;
        const rosters = await rostersRes.json();
        const roster = rosters.find(r => r.owner_id === managerId || (r.co_owners && r.co_owners.includes(managerId)));
        
        if (roster) {
          const wins = roster.settings?.wins || 0;
          const losses = roster.settings?.losses || 0;
          
          // Only push to history if they actually played games that year.
          // This prevents a 0-0 pre-season record from confusing the AI.
          if (wins > 0 || losses > 0) {
            history.push({ year: actualSeasonYear, wins, losses });
          }
          
          // Always capture the most recent roster for the snapshot
          if (!foundRoster) foundRoster = roster;
        }

        currentLeagueId = lData.previous_league_id;
      }
    } catch (sleeperErr) {
        throw new Error(`Sleeper API fetch failed: ${sleeperErr.message}`);
    }

    // --- STEP 2: GEMINI AI GENERATION ---
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

    // Give the AI strict contextual rules about the timeline
    const prompt = history.length === 0 
      ? `Analyze a new manager named ${teamName} who has just joined a Dynasty Fantasy Football league. They have no historical roster data. Return a raw JSON object with exactly three keys: "strategy", "profile", "philosophy". Keep it welcoming and professional.`
      : `You are a Dynasty Fantasy Football Analyst. Evaluate manager: ${teamName}. 
      CRITICAL TIMELINE RULE: We are currently in the ${currentYear} pre-season. The ${currentYear} season has NOT started yet. 
      Completed Past Seasons History: ${JSON.stringify(history)}. 
      Current ${currentYear} Roster Snapshot: ${JSON.stringify(foundRoster?.starters)}. 
      
      Return a raw JSON object with exactly three keys: "strategy", "profile", "philosophy". Do not use markdown blocks. Do not state they finished the ${currentYear} season.`;

    const result = await model.generateContent(prompt);

    if (!result.response.candidates || result.response.candidates.length === 0) {
        throw new Error(`Gemini blocked the response. Finish Reason: ${result.response.promptFeedback?.blockReason || "Unknown"}`);
    }

    const evaluation = result.response.text();
    res.status(200).json({ evaluation });

  } catch (error) {
    console.error("Backend Crash:", error);
    res.status(500).json({ error: error.toString() });
  }
}