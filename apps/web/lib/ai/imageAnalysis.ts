// Analyse d'image locale (zero-shot CLIP) → suggestions de catégories et tags.
// Orchestrateur côté thread principal : délègue l'inférence au Web Worker
// (lib/ai/vision.worker.ts), repli sur le thread principal si le worker échoue.
// Aucune API externe — le modèle (~150 Mo) est téléchargé une fois puis mis en
// cache (Cache Storage). L'utilisateur valide TOUJOURS les suggestions.

import { CATEGORY_CONCEPTS, TAG_CONCEPTS, HYPOTHESIS_TEMPLATE } from "@/lib/ai/imageVocab";

export interface AnalysisProgress { phase: "downloading" | "classifying"; loadedMB?: number; totalMB?: number }

export interface CategorySuggestion {
  category: string;
  subcategory: string;
  score: number;
}
export interface TagSuggestion {
  label: string;
  score: number;
}
export interface ImageAnalysis {
  categories: CategorySuggestion[];
  tags: TagSuggestion[];
}

// Combien de suggestions on remonte (l'utilisateur trie ensuite). Un plancher
// écarte le bruit pur ; le classement CLIP fait le reste.
const MAX_CATEGORIES = 3;
const MAX_TAGS = 6;
const MIN_SCORE = 0.02;

type Scored = { label: string; score: number };
type Groups = Record<string, string[]>;

function buildGroups(): Groups {
  return {
    categories: CATEGORY_CONCEPTS.map((c) => c.prompt),
    tags: TAG_CONCEPTS.map((t) => t.prompt),
  };
}

function mapResult(result: Record<string, Scored[]>): ImageAnalysis {
  const byCatPrompt = new Map(CATEGORY_CONCEPTS.map((c) => [c.prompt, c]));
  const byTagPrompt = new Map(TAG_CONCEPTS.map((t) => [t.prompt, t]));
  const categories: CategorySuggestion[] = (result.categories ?? [])
    .map((r) => {
      const c = byCatPrompt.get(r.label);
      return c ? { category: c.category, subcategory: c.subcategory, score: r.score } : null;
    })
    .filter((x): x is CategorySuggestion => x !== null && x.score >= MIN_SCORE)
    .slice(0, MAX_CATEGORIES);
  const tags: TagSuggestion[] = (result.tags ?? [])
    .map((r) => {
      const t = byTagPrompt.get(r.label);
      return t ? { label: t.label, score: r.score } : null;
    })
    .filter((x): x is TagSuggestion => x !== null && x.score >= MIN_SCORE)
    .slice(0, MAX_TAGS);
  return { categories, tags };
}

// ── Worker (par défaut) ──────────────────────────────────────────────────────
let worker: Worker | null = null;
let workerUnavailable = false;
let msgSeq = 0;
function getWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./vision.worker.ts", import.meta.url), { type: "module" });
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function analyzeInWorker(w: Worker, imageUrl: string, onProgress?: (p: AnalysisProgress) => void): Promise<ImageAnalysis> {
  const id = ++msgSeq;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { id: number; type: string; progress?: AnalysisProgress; result?: Record<string, Scored[]>; message?: string };
      if (data.id !== id) return;
      if (data.type === "progress" && data.progress) onProgress?.(data.progress);
      else if (data.type === "done" && data.result) { cleanup(); resolve(mapResult(data.result)); }
      else if (data.type === "error") { cleanup(); reject(new Error(data.message ?? "worker error")); }
    };
    const onError = (err: ErrorEvent) => { cleanup(); reject(err.error ?? new Error(err.message)); };
    const cleanup = () => { w.removeEventListener("message", onMessage); w.removeEventListener("error", onError); };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, imageUrl, groups: buildGroups(), template: HYPOTHESIS_TEMPLATE });
  });
}

// ── Repli thread principal ───────────────────────────────────────────────────
type ZeroShot = (image: string, labels: string[], opts?: { hypothesis_template?: string }) => Promise<Scored[]>;
let clfPromise: Promise<ZeroShot> | null = null;
async function analyzeOnMainThread(imageUrl: string, onProgress?: (p: AnalysisProgress) => void): Promise<ImageAnalysis> {
  if (!clfPromise) {
    clfPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const clf = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch16", {
        progress_callback: (p: { status?: string; loaded?: number; total?: number }) => {
          if (p.status === "progress" && p.loaded && p.total) {
            onProgress?.({ phase: "downloading", loadedMB: Math.round(p.loaded / 1048576), totalMB: Math.round(p.total / 1048576) });
          }
        },
      });
      return clf as unknown as ZeroShot;
    })();
    clfPromise.catch(() => { clfPromise = null; });
  }
  const clf = await clfPromise;
  onProgress?.({ phase: "classifying" });
  const groups = buildGroups();
  const result: Record<string, Scored[]> = {};
  for (const [key, labels] of Object.entries(groups)) {
    result[key] = labels.length ? await clf(imageUrl, labels, { hypothesis_template: HYPOTHESIS_TEMPLATE }) : [];
  }
  return mapResult(result);
}

/** Analyse une image (URL publique) et retourne des suggestions de catégories/tags. */
export async function analyzeImage(imageUrl: string, onProgress?: (p: AnalysisProgress) => void): Promise<ImageAnalysis> {
  const w = getWorker();
  if (w) {
    try {
      return await analyzeInWorker(w, imageUrl, onProgress);
    } catch {
      workerUnavailable = true;
      try { worker?.terminate(); } catch { /* déjà mort */ }
      worker = null;
      return analyzeOnMainThread(imageUrl, onProgress);
    }
  }
  return analyzeOnMainThread(imageUrl, onProgress);
}
