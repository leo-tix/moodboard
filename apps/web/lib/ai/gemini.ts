import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface ImageAnalysis {
  tags: string[];
  styleKeywords: string[];
  moodDescriptor: string;
  technicalNotes: string;
  suggestedTitle?: string;
}

const ANALYSIS_PROMPT = `Tu es un expert en direction artistique et histoire de l'art.
Analyse cette image et réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "tags": ["tag1", "tag2", ...],
  "styleKeywords": ["mot1", "mot2", ...],
  "moodDescriptor": "une phrase courte décrivant l'ambiance",
  "technicalNotes": "notes sur la technique, composition, lumière",
  "suggestedTitle": "titre suggéré si pertinent"
}

Pour les tags (max 15): couleurs dominantes, style artistique, technique, époque, thème, émotion, composition.
Pour styleKeywords (max 8): mouvement artistique, influences, esthétique.
Réponds en français.`;

// Analyse une image encodée en base64 avec Gemini Vision
export async function analyzeImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string = "image/jpeg"
): Promise<ImageAnalysis> {
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [
      {
        parts: [
          { text: ANALYSIS_PROMPT },
          {
            inlineData: {
              data: imageBuffer.toString("base64"),
              mimeType,
            },
          },
        ],
      },
    ],
    config: {
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
  });

  const text = response.text ?? "";

  if (!text) {
    throw new Error("Réponse Gemini vide");
  }

  // Extraire le JSON — gère le markdown (```json ... ```) et le JSON brut
  const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const rawJson = text.match(/\{[\s\S]*\}/);
  const jsonStr = codeBlock ? codeBlock[1] : rawJson ? rawJson[0] : null;

  if (!jsonStr) {
    console.error("[Gemini] Réponse brute :", text.slice(0, 500));
    throw new Error(`Réponse Gemini invalide: ${text.slice(0, 120)}`);
  }

  try {
    return JSON.parse(jsonStr) as ImageAnalysis;
  } catch {
    console.error("[Gemini] JSON invalide :", jsonStr.slice(0, 500));
    throw new Error("JSON Gemini non parseable");
  }
}
