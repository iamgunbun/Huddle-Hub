import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Backend Error: Missing Gemini API Key." });
  }

  const { teamName, currentRosterPlayers, leagueFormat, history: clientHistory, season, seasonPhase, currentWeek } = req.body;

  // Both the league's format (Redraft/Keeper/Dynasty) and this manager's
  // season-by-season history used to be re-derived here via raw Sleeper-only
  // fetches -- which silently produced nothing for a Yahoo league (the fetch
  // 404s on a Yahoo league key, and the loop just stops) and defaulted to
  // "Dynasty" for every league that fell through that gap. The app's own
  // client-side helpers already compute both correctly for either platform
  // (see src/pages/Managers.jsx and src/utils/leagueFormat.js), so they're
  // trusted here instead of rebuilt from scratch. "Redraft" is the one
  // fallback kept server-side, since it's the common case rather than a
  // guess dressed up as a bigger commitment.
  const leagueTypeStr = leagueFormat || "Redraft";
  const history = Array.isArray(clientHistory) ? clientHistory : [];

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // --- GEMINI COMPILATION ENGINE ---
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
        model: "gemini-3.5-flash",
        safetySettings,
        generationConfig: { 
            responseMimeType: "application/json",
            responseSchema: responseSchema
        } 
    });
    
    const currentYear = season || new Date().getFullYear();

    // This used to hardcode "we are in the pre-season" unconditionally, which
    // goes wrong the moment the season actually starts: the model would keep
    // insisting a season with real, in-progress results (visible in the
    // history block below) hadn't begun yet. The real NFL state -- supplied
    // by the client -- decides which framing is actually true right now.
    let timelineRule;
    if (seasonPhase === 'in-season') {
        timelineRule = `We are in Week ${currentWeek || '?'} of the ${currentYear} regular season, which is already underway. Speak about it in the present tense -- games have been played and results already exist.`;
    } else if (seasonPhase === 'postseason') {
        timelineRule = `The ${currentYear} regular season has concluded and the playoffs are underway or finished. Speak about the ${currentYear} regular season's results in the past tense where appropriate.`;
    } else if (seasonPhase === 'offseason') {
        timelineRule = `The ${currentYear} season is over and the league is in its offseason. Speak about the ${currentYear} season in the past tense, and about roster moves as offseason planning for the next season.`;
    } else {
        timelineRule = `We are currently in the ${currentYear} preseason. The ${currentYear} season has NOT started yet. Do not speak about the ${currentYear} season in the past tense.`;
    }

    const prompt = `You are an expert ${leagueTypeStr} Fantasy Football Analyst. Evaluate manager: ${teamName}.

    CRITICAL LEAGUE TYPE RULE: This is a ${leagueTypeStr} league. Adjust your strategy language accordingly.
    CRITICAL TIMELINE RULE: ${timelineRule}

    Season-by-season Win/Loss Records for this Franchise Slot (the most recent entry may be the current, still in-progress season -- check the timeline rule above before treating it as final):
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