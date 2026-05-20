import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface ImageAnalysis {
  tags: string[];
  styleKeywords: string[];
  moodDescriptor: string;
  technicalNotes: string;
  suggestedTitle?: string;
  suggestedCategoryIds?: string[];
}

export interface CategoryHint {
  id: string;
  name: string;
}

function buildPrompt(categories: CategoryHint[]): string {
  const catList = categories.map((c) => `- id: "${c.id}", nom: "${c.name}"`).join("\n");
  return `Tu es un expert en direction artistique et histoire de l'art.
Analyse cette image et réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "tags": ["tag1", "tag2", ...],
  "styleKeywords": ["mot1", "mot2", ...],
  "moodDescriptor": "une phrase courte décrivant l'ambiance",
  "technicalNotes": "notes sur la technique, composition, lumière",
  "suggestedTitle": "titre suggéré si pertinent",
  "suggestedCategoryIds": ["id1", "id2"]
}

Pour les tags (max 15): couleurs dominantes, style artistique, technique, époque, thème, émotion, composition.
Pour styleKeywords (max 8): mouvement artistique, influences, esthétique.
Pour suggestedCategoryIds: choisis parmi ces catégories disponibles celles qui correspondent le mieux à l'image (0 à 3 maximum, utilise exactement les ids fournis):
${catList}
Réponds en français.`;
}

// Analyse une image encodée en base64 avec Gemini Vision
export async function analyzeImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string = "image/jpeg",
  categories: CategoryHint[] = []
): Promise<ImageAnalysis> {
  const prompt = buildPrompt(categories);
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [
      {
        parts: [
          { text: prompt },
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
