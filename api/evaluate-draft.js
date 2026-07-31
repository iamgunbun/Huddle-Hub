import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Missing Gemini API Key." });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "System Prompt is required" });

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];

    const responseSchema = {
      type: SchemaType.OBJECT,
      properties: {
        grade: { type: SchemaType.STRING, description: "Overall draft letter grade (e.g. A, B+, C-)" },
        summary: { type: SchemaType.STRING, description: "A 3-5 word headline summarizing the draft" },
        analysis: { type: SchemaType.STRING, description: "Detailed 4-5 sentence analysis of the picks." }
      },
      required: ["grade", "summary", "analysis"]
    };

    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        safetySettings,
        generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema } 
    });

    const result = await model.generateContent(prompt);
    res.status(200).json({ evaluation: result.response.text() });
  } catch (error) {
    if (error.message && error.message.includes("429")) {
        res.status(429).json({ error: "Speed limit reached. Please wait 60 seconds." });
    } else {
        res.status(500).json({ error: error.toString() });
    }
  }
}