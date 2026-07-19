// Analyse d'image locale (zero-shot CLIP) → suggestions de catégories et tags.
// Orchestrateur côté thread principal : délègue l'inférence au Web Worker
// (lib/ai/vision.worker.ts), repli sur le thread principal si le worker échoue.
// Aucune API externe — le modèle (~150 Mo) est téléchargé une fois puis mis en
// cache (Cache Storage). L'utilisateur valide TOUJOURS les suggestions.

import { CATEGORY_CONCEPTS, TAG_CONCEPTS, TAG_GROUPS } from "@/lib/ai/imageVocab";

export interface AnalysisProgress { phase: "downloading" | "classifying"; loadedMB?: number; totalMB?: number }

export interface CategorySuggestion {
  category: string;
  subcategory: string;
  score: number;
}
export interface TagSuggestion {
  label: string;
  score: number;
  /** Dimension sémantique (sujet, couleur, composition…) — sert à composer les titres. */
  group: string;
}
export interface ImageAnalysis {
  categories: CategorySuggestion[];
  tags: TagSuggestion[];
  /** Titres candidats (français), dérivés de la catégorie + tags dominants. */
  titles: string[];
}

const MAX_CATEGORIES = 3;
const MIN_CAT_SCORE = 0.02;
// Par groupe de tags : on garde le top 2 au-dessus d'un plancher (softmax
// interne au groupe → un bon match sort nettement au-dessus de 0.18).
const PER_GROUP_KEEP = 2;
const MIN_TAG_SCORE = 0.18;
const MAX_TAGS = 8;

type Scored = { label: string; score: number };
type Groups = Record<string, string[]>;

const TAG_GROUP_KEYS = Object.keys(TAG_GROUPS).map((k) => `tag:${k}`);

function buildGroups(): Groups {
  const groups: Groups = { categories: CATEGORY_CONCEPTS.map((c) => c.prompt) };
  for (const [name, concepts] of Object.entries(TAG_GROUPS)) {
    groups[`tag:${name}`] = concepts.map((c) => c.prompt);
  }
  return groups;
}

// Le worker renvoie des LOGITS bruts (échelle CLIP) par groupe → softmax PAR
// groupe ici (chaque dimension a sa propre distribution).
function softmaxGroup(scored: Scored[]): Scored[] {
  if (!scored.length) return scored;
  const max = Math.max(...scored.map((s) => s.score));
  const exps = scored.map((s) => Math.exp(s.score - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return scored.map((s, i) => ({ label: s.label, score: exps[i] / sum }));
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function buildTitles(categories: CategorySuggestion[], tags: TagSuggestion[]): string[] {
  // Meilleur tag de chaque dimension → composition d'un descriptif français.
  const top = (g: string) => tags.find((t) => t.group === g)?.label;
  const subj = top("sujet");
  const col = top("couleur");
  const comp = top("composition");
  const tech = top("technique");
  const sub = categories[0]?.subcategory;
  const out: string[] = [];
  // 1) Descriptif riche : sujet + couleur + composition (ce qui existe).
  const desc = [subj, col, comp].filter(Boolean);
  if (desc.length >= 2) out.push(cap(desc.join(" ")));
  // 2) Angle technique : « Photographie — intérieur ».
  if (tech && subj) out.push(`${cap(tech)} — ${subj}`);
  // 3) Sous-catégorie + 1er tag.
  if (sub && tags[0]) out.push(`${cap(sub)} ${tags[0].label}`);
  // 4) Replis simples.
  if (sub) out.push(cap(sub));
  if (subj) out.push(cap(subj));
  return [...new Set(out.filter(Boolean))].slice(0, 3);
}

function mapResult(raw: Record<string, Scored[]>): ImageAnalysis {
  const byCatPrompt = new Map(CATEGORY_CONCEPTS.map((c) => [c.prompt, c]));
  const byTagPrompt = new Map(TAG_CONCEPTS.map((t) => [t.prompt, t]));

  // Softmax PAR groupe (le worker renvoie des logits bruts).
  const result: Record<string, Scored[]> = {};
  for (const [key, scored] of Object.entries(raw)) result[key] = softmaxGroup(scored);

  const categories: CategorySuggestion[] = (result.categories ?? [])
    .map((r) => {
      const c = byCatPrompt.get(r.label);
      return c ? { category: c.category, subcategory: c.subcategory, score: r.score } : null;
    })
    .filter((x): x is CategorySuggestion => x !== null && x.score >= MIN_CAT_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CATEGORIES);

  // Tags : top de CHAQUE groupe (softmax interne), fusionnés puis triés.
  const tags: TagSuggestion[] = TAG_GROUP_KEYS.flatMap((key) =>
    (result[key] ?? [])
      .map((r) => {
        const t = byTagPrompt.get(r.label);
        return t ? { label: t.label, score: r.score, group: key.replace("tag:", "") } : null;
      })
      .filter((x): x is TagSuggestion => x !== null && x.score >= MIN_TAG_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_GROUP_KEEP),
  )
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TAGS);

  return { categories, tags, titles: buildTitles(categories, tags) };
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
    w.postMessage({ id, imageUrl, groups: buildGroups() });
  });
}

// ── Repli thread principal (même encodage unique que le worker) ──────────────
interface ClipLoaded {
  model: (inputs: Record<string, unknown>) => Promise<{ logits_per_image: { tolist(): number[][] } }>;
  processor: (img: unknown) => Promise<Record<string, unknown>>;
  tokenizer: (texts: string[], opts: Record<string, unknown>) => Record<string, unknown>;
  RawImage: { read(url: string): Promise<unknown> };
}
let clipPromise: Promise<ClipLoaded> | null = null;
async function analyzeOnMainThread(imageUrl: string, onProgress?: (p: AnalysisProgress) => void): Promise<ImageAnalysis> {
  if (!clipPromise) {
    clipPromise = (async () => {
      const { CLIPModel, AutoProcessor, AutoTokenizer, RawImage } = await import("@huggingface/transformers");
      const id = "Xenova/clip-vit-base-patch16";
      const progress_callback = (p: { status?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.loaded && p.total) {
          onProgress?.({ phase: "downloading", loadedMB: Math.round(p.loaded / 1048576), totalMB: Math.round(p.total / 1048576) });
        }
      };
      const [model, processor, tokenizer] = await Promise.all([
        CLIPModel.from_pretrained(id, { progress_callback }),
        AutoProcessor.from_pretrained(id),
        AutoTokenizer.from_pretrained(id),
      ]);
      return { model, processor, tokenizer, RawImage } as unknown as ClipLoaded;
    })();
    clipPromise.catch(() => { clipPromise = null; });
  }
  const { model, processor, tokenizer, RawImage } = await clipPromise;
  onProgress?.({ phase: "classifying" });
  const groups = buildGroups();
  const allPrompts: string[] = [];
  const ranges: Record<string, [number, number]> = {};
  for (const [key, prompts] of Object.entries(groups)) {
    const start = allPrompts.length;
    allPrompts.push(...prompts);
    ranges[key] = [start, allPrompts.length];
  }
  const image = await RawImage.read(imageUrl);
  const imageInputs = await processor(image);
  const textInputs = tokenizer(allPrompts, { padding: true, truncation: true });
  const output = await model({ ...textInputs, ...imageInputs });
  const logits = output.logits_per_image.tolist()[0];
  const result: Record<string, Scored[]> = {};
  for (const [key, [start, end]] of Object.entries(ranges)) {
    result[key] = groups[key].map((label, i) => ({ label, score: logits[start + i] }));
  }
  return mapResult(result);
}

// La visionneuse affiche l'image via un <img> SANS crossorigin → le navigateur
// met en cache une réponse OPAQUE. Un fetch par défaut de la même URL réutilise
// cette entrée opaque → échec CORS « Failed to fetch » (retour 2026-07-19
// « échoue dans la visionneuse »). Une query unique force une VRAIE requête CORS
// (entrée de cache distincte), qui récupère bien les en-têtes CORS de R2.
function withCorsBust(url: string): string {
  return url + (url.includes("?") ? "&" : "?") + "mbai=1";
}

async function runAnalysis(imageUrl: string, onProgress?: (p: AnalysisProgress) => void): Promise<ImageAnalysis> {
  const fetchUrl = withCorsBust(imageUrl);
  const w = getWorker();
  if (w) {
    try {
      return await analyzeInWorker(w, fetchUrl, onProgress);
    } catch {
      workerUnavailable = true;
      try { worker?.terminate(); } catch { /* déjà mort */ }
      worker = null;
      return analyzeOnMainThread(fetchUrl, onProgress);
    }
  }
  return analyzeOnMainThread(fetchUrl, onProgress);
}

// SÉRIALISATION : le modèle CLIP (session ONNX) n'est PAS ré-entrant — deux
// `model()` concurrents le corrompent. Or la visionneuse monte DEUX panneaux
// (feuille mobile + colonne desktop) qui lancent l'analyse en même temps
// (retour 2026-07-19 « échoue dans la visionneuse »). On enchaîne donc les
// analyses, et on met en cache le résultat par URL → le 2e panneau réutilise
// le 1er instantanément (même image), sans 2e inférence.
const analysisCache = new Map<string, ImageAnalysis>();
let analysisChain: Promise<unknown> = Promise.resolve();

/** Analyse une image (URL publique) et retourne des suggestions de catégories/tags. */
export function analyzeImage(imageUrl: string, onProgress?: (p: AnalysisProgress) => void): Promise<ImageAnalysis> {
  const next = analysisChain.then(
    async () => {
      const cached = analysisCache.get(imageUrl);
      if (cached) return cached;
      const res = await runAnalysis(imageUrl, onProgress);
      analysisCache.set(imageUrl, res);
      return res;
    },
    async () => {
      // Le maillon précédent a échoué — on tente quand même celui-ci.
      const cached = analysisCache.get(imageUrl);
      if (cached) return cached;
      const res = await runAnalysis(imageUrl, onProgress);
      analysisCache.set(imageUrl, res);
      return res;
    },
  );
  // La chaîne ne doit jamais rester en rejet (sinon tous les suivants tombent
  // dans le 2e callback en boucle) — on l'assainit.
  analysisChain = next.catch(() => {});
  return next;
}
