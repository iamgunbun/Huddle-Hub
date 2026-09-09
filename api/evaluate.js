// api/evaluate.js
//
// Every Gemini-backed grading/evaluation endpoint lives in this one file,
// the same reason api/resend.js is one file: Vercel's Hobby plan caps a
// deployment at 12 Serverless Functions (one per file in api/), and this
// app was already sitting at that exact cap. Four near-identical files here
// (evaluate-draft/manager/start-sit/trade -- same model, same safety
// settings, only the response schema and, for manager, the prompt-building
// differed) would have blocked room for anything new. Dispatched by an
// `action` field in the JSON body instead of separate endpoint URLs.

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType } from "@google/generative-ai";

const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const RESPONSE_SCHEMAS = {
    manager: {
        type: SchemaType.OBJECT,
        properties: {
            strategy: { type: SchemaType.STRING, description: "A 1-2 sentence evaluation of their current roster composition." },
            profile: { type: SchemaType.STRING, description: "A 1-2 sentence summary of their overall performance and history." },
            philosophy: { type: SchemaType.STRING, description: "A 1-2 sentence prediction on their trading style and roster management habits." }
        },
        required: ["strategy", "profile", "philosophy"]
    },
    'start-sit': {
        type: SchemaType.OBJECT,
        properties: {
            recommendedId: { type: SchemaType.STRING, description: "The exact Sleeper Player ID of the recommended winner." },
            confidence: { type: SchemaType.INTEGER, description: "An integer between 0 and 100 representing confidence based on matchup clarity." },
            verdict: { type: SchemaType.STRING, description: "A short string stating who to start, formatted as 'Start [Winner Name]'." },
            reasoning: { type: SchemaType.STRING, description: "A highly detailed, 4-5 sentence analysis explicitly naming the opposing teams, stating their defensive ranks against the position, detailing game conditions, and explaining the tactical advantage." }
        },
        required: ["recommendedId", "confidence", "verdict", "reasoning"]
    },
    draft: {
        type: SchemaType.OBJECT,
        properties: {
            grade: { type: SchemaType.STRING, description: "Overall draft letter grade (e.g. A, B+, C-)" },
            summary: { type: SchemaType.STRING, description: "A 3-5 word headline summarizing the draft" },
            analysis: { type: SchemaType.STRING, description: "Detailed 4-5 sentence analysis of the picks." }
        },
        required: ["grade", "summary", "analysis"]
    },
    trade: {
        type: SchemaType.OBJECT,
        properties: {
            gradeA: { type: SchemaType.STRING, description: "Letter grade for Side A (e.g. A, B+, C-)" },
            gradeB: { type: SchemaType.STRING, description: "Letter grade for Side B (e.g. A, B+, C-)" },
            winner: { type: SchemaType.STRING, description: "State which side wins, or 'Even'" },
            analysis: { type: SchemaType.STRING, description: "Detailed 4-5 sentence analysis." }
        },
        required: ["gradeA", "gradeB", "winner", "analysis"]
    },
};

// The only action that builds its own prompt server-side rather than
// receiving a pre-built one -- kept exactly as evaluate-manager.js had it.
const buildManagerPrompt = ({ teamName, currentRosterPlayers, leagueFormat, history: clientHistory, season, seasonPhase, currentWeek }) => {
    const leagueTypeStr = leagueFormat || "Redraft";
    const history = Array.isArray(clientHistory) ? clientHistory : [];
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

    return `You are an expert ${leagueTypeStr} Fantasy Football Analyst. Evaluate manager: ${teamName}.

    CRITICAL LEAGUE TYPE RULE: This is a ${leagueTypeStr} league. Adjust your strategy language accordingly.
    CRITICAL TIMELINE RULE: ${timelineRule}

    Season-by-season Win/Loss Records for this Franchise Slot (the most recent entry may be the current, still in-progress season -- check the timeline rule above before treating it as final):
    ${JSON.stringify(history)}

    ACTUAL CURRENT ROSTER OF PLAYERS FOR THE UPCOMING ${currentYear} SEASON:
    ${JSON.stringify(currentRosterPlayers)}

    CRITICAL ROSTER INTEGRITY RULE: You must ONLY evaluate the specific players listed in the current roster above. Do not invent, assume, or hallucinate any other players. If the list is empty, state they are currently clearing space or drafting.`;
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Missing Gemini API Key." });

    const body = req.body || {};
    const schema = RESPONSE_SCHEMAS[body.action];
    if (!schema) return res.status(400).json({ error: 'Unknown or missing action' });

    let prompt;
    if (body.action === 'manager') {
        prompt = buildManagerPrompt(body);
    } else {
        prompt = body.prompt;
        if (!prompt) return res.status(400).json({ error: 'System Prompt is required' });
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-3.5-flash",
            safetySettings: SAFETY_SETTINGS,
            generationConfig: { responseMimeType: "application/json", responseSchema: schema }
        });

        const result = await model.generateContent(prompt);

        if (!result.response.candidates || result.response.candidates.length === 0) {
            throw new Error(`Gemini blocked the response due to safety thresholds.`);
        }

        res.status(200).json({ evaluation: result.response.text() });
    } catch (error) {
        console.error("Backend Crash:", error);
        if (error.message && error.message.includes("429")) {
            res.status(429).json({ error: "Google API Free Tier speed limit reached (20 requests per minute). Please wait 60 seconds and try again." });
        } else {
            res.status(500).json({ error: error.toString() });
        }
    }
}
