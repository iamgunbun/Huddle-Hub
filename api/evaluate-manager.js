import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType } from "@google/generative-ai";

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
    let targetRosterId = null;
    let leagueTypeStr = "Dynasty"; 
    let isFirstLeagueFetch = true;

    try {
      while (currentLeagueId && currentLeagueId !== "0" && currentLeagueId !== 0) {
        const lRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeagueId}`);
        if (!lRes.ok) break;
        const lData = await lRes.json();
        const actualSeasonYear = lData.season;

        if (isFirstLeagueFetch) {
            const typeCode = lData.settings?.type || 0;
            leagueTypeStr = typeCode === 2 ? "Dynasty" : (typeCode === 1 ? "Keeper" : "Redraft");
            isFirstLeagueFetch = false;
        }

        const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeagueId}/rosters`);
        if (!rostersRes.ok) break;
        const rosters = await rostersRes.json();
        
        let roster;
        if (!targetRosterId) {
            roster = rosters.find(r => r.owner_id === managerId || (r.co_owners && r.co_owners.includes(managerId)));
            if (roster) targetRosterId = roster.roster_id; 
        } else {
            roster = rosters.find(r => r.roster_id === targetRosterId);
        }
        
        if (roster) {
          const wins = roster.settings?.wins || 0;
          const losses = roster.settings?.losses || 0;
          const wasDifferentOwner = (roster.owner_id !== managerId) && (!roster.co_owners || !roster.co_owners.includes(managerId));
          
          if (wins > 0 || losses > 0) {
            history.push({ 
                year: actualSeasonYear, 
                wins, 
                losses,
                note: wasDifferentOwner ? "Inherited orphan team." : "Managed by current user."
            });
          }
        }
        
        currentLeagueId = lData.previous_league_id;
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

    const responseSchema = {
      type: SchemaType.OBJECT,
      properties: {
        strategy: { type: SchemaType.STRING, description: "A 1-2 sentence evaluation of their current roster composition." },
        profile: { type: SchemaType.STRING, description: "A 1-2 sentence summary of their overall performance and history." },
        philosophy: { type: SchemaType.STRING, description: "A 1-2 sentence prediction on their trading style and roster management habits." }
      },
      required: ["strategy", "profile", "philosophy"]
    };

    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        safetySettings,
        generationConfig: { 
            responseMimeType: "application/json",
            responseSchema: responseSchema
        } 
    });
    
    const currentYear = new Date().getFullYear();

    const prompt = `You are an expert ${leagueTypeStr} Fantasy Football Analyst. Evaluate manager: ${teamName}.
    
    CRITICAL LEAGUE TYPE RULE: This is a ${leagueTypeStr} league. Adjust your strategy language accordingly.
    CRITICAL TIMELINE RULE: We are currently in the ${currentYear} pre-season. The ${currentYear} season has NOT started yet. Do not speak about the ${currentYear} season in the past tense.
    
    Completed Past Seasons Historical Performance Records for this Franchise Slot:
    ${JSON.stringify(history)}
    
    ACTUAL CURRENT ROSTER OF PLAYERS FOR THE UPCOMING ${currentYear} SEASON:
    ${JSON.stringify(currentRosterPlayers)}
    
    CRITICAL ROSTER INTEGRITY RULE: You must ONLY evaluate the specific players listed in the current roster above. Do not invent, assume, or hallucinate any other players. If the list is empty, state they are currently clearing space or drafting.`;

    const result = await model.generateContent(prompt);

    if (!result.response.candidates || result.response.candidates.length === 0) {
        throw new Error(`Gemini blocked the response.`);
    }

    const evaluation = result.response.text();
    res.status(200).json({ evaluation });

  } catch (error) {
    console.error("Backend Crash:", error);
    // Gracefully handle the 429 Rate Limit error
    if (error.message.includes("429")) {
        res.status(429).json({ error: "Google API Free Tier speed limit reached (20 requests per minute). Please wait 60 seconds and try again." });
    } else {
        res.status(500).json({ error: error.toString() });
    }
  }
}