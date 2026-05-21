import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ─── Rate-limit error ─────────────────────────────────────────────────────────

export class GeminiRateLimitError extends Error {
  readonly retryAfter: number;
  constructor(retryAfter = 60) {
    super(`Gemini rate limit exceeded. Retry after ${retryAfter}s`);
    this.name = "GeminiRateLimitError";
    this.retryAfter = retryAfter;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("ratelimit")
  );
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    isRateLimitError(error) ||
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("overloaded")
  );
}

/**
 * Try to extract an explicit retry delay (in seconds) from the error message.
 * Gemini sometimes embeds "retryDelay" or "Retry-After" in the error body.
 */
function extractRetryAfter(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match =
    error.message.match(/retry.?after[: ]+(\d+)/i) ||
    error.message.match(/"seconds"\s*:\s*"?(\d+)"?/);
  return match ? parseInt(match[1], 10) : null;
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

/**
 * Wraps any async call with exponential back-off retry logic.
 * Retries on rate-limit (429 / RESOURCE_EXHAUSTED) and transient server errors (503).
 * After exhausting all retries, throws GeminiRateLimitError.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  // Back-off schedule: 5s → 15s → 30s
  const backoffMs = [5_000, 15_000, 30_000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Non-retryable errors are re-thrown immediately
      if (!isRetryableError(error)) throw error;

      // Last attempt exhausted
      if (attempt === maxRetries) break;

      // Honour explicit retry-after from the API if present
      const explicit = extractRetryAfter(error);
      const delay = explicit !== null ? explicit * 1000 : (backoffMs[attempt] ?? 30_000);

      console.warn(
        `[Gemini] ${isRateLimitError(error) ? "Rate limit" : "Service unavailable"} ` +
          `— retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s`
      );

      await sleep(delay);
    }
  }

  const retryAfter = extractRetryAfter(lastError) ?? 60;
  throw new GeminiRateLimitError(retryAfter);
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Prompt ───────────────────────────────────────────────────────────────────

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

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Analyse une image encodée en base64 avec Gemini Vision.
 * Retries automatically on rate-limit / transient errors.
 * Throws GeminiRateLimitError if all retries are exhausted.
 */
export async function analyzeImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string = "image/jpeg",
  categories: CategoryHint[] = []
): Promise<ImageAnalysis> {
  const prompt = buildPrompt(categories);

  const raw = await withRetry(() =>
    ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
          ],
        },
      ],
      config: { temperature: 0.3, maxOutputTokens: 4096 },
    })
  );

  const text = raw.text ?? "";
  if (!text) throw new Error("Réponse Gemini vide");

  // Extract JSON — handles ```json ... ``` markdown fences or bare JSON
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
