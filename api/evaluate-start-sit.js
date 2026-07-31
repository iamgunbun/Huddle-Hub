import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType } from "@google/generative-ai";

export default async function handler(req, res) {
  // 1. Block unauthorized request types
  if (req.method !== 'POST') return res.status(405).end();

  // 2. Validate API Key Presence
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Backend Error: Missing Gemini API Key." });
  }

  // 3. Extract the pre-formatted prompt sent from StartSit.jsx
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "System Prompt is required" });
  }

  try {
    // 4. Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];

    // 5. Enforce Strict JSON Schema Structure
    const responseSchema = {
      type: SchemaType.OBJECT,
      properties: {
        recommendedId: { 
            type: SchemaType.STRING, 
            description: "The exact Sleeper Player ID of the recommended winner." 
        },
        confidence: { 
            type: SchemaType.INTEGER, 
            description: "An integer between 0 and 100 representing confidence based on matchup clarity." 
        },
        verdict: { 
            type: SchemaType.STRING, 
            description: "A short string stating who to start, formatted as 'Start [Winner Name]'." 
        },
        reasoning: { 
            type: SchemaType.STRING, 
            description: "A highly detailed, 4-5 sentence analysis explicitly naming the opposing teams, stating their defensive ranks against the position, detailing game conditions, and explaining the tactical advantage." 
        }
      },
      required: ["recommendedId", "confidence", "verdict", "reasoning"]
    };

    // 6. Configure Model Engine
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        safetySettings,
        generationConfig: { 
            responseMimeType: "application/json",
            responseSchema: responseSchema
        } 
    });

    // 7. Execute AI Generation
    const result = await model.generateContent(prompt);

    if (!result.response.candidates || result.response.candidates.length === 0) {
        throw new Error(`Gemini blocked the response due to safety thresholds.`);
    }

    const evaluation = result.response.text();

    // 8. Return wrapped evaluation format to match the parser logic
    res.status(200).json({ evaluation });

  } catch (error) {
    console.error("Backend Crash:", error);
    
    // Gracefully handle the Google API 429 Rate Limit error
    if (error.message && error.message.includes("429")) {
        res.status(429).json({ error: "Google API Free Tier speed limit reached (20 requests per minute). Please wait 60 seconds and try again." });
    } else {
        res.status(500).json({ error: error.toString() });
    }
  }
}