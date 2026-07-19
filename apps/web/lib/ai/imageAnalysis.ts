// Analyse d'image locale (SigLIP, zero-shot) → suggestions de catégories/tags.
// Orchestrateur côté thread principal : délègue l'inférence au Web Worker
// (lib/ai/vision.worker.ts), repli sur le thread principal si le worker échoue.
// Aucune API externe. Les embeddings texte du vocabulaire sont PRÉ-CALCULÉS
// (siglipTextEmbeds.json) → au runtime seul l'encodeur d'IMAGE de SigLIP est
// téléchargé/exécuté, chaque image = un encodage + un produit scalaire. Le
// worker renvoie donc directement un COSINUS par libellé (ordre flatConcepts()).
// L'utilisateur valide TOUJOURS les suggestions.

import { flatConcepts } from "@/lib/ai/imageVocab";
import { scoreImageEmbedding } from "@/lib/ai/siglipEmbeds";

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
  /** Titres DESCRIPTIFS (français), dérivés de la catégorie + tags dominants. */
  titles: string[];
  /** Titres CRÉATIFS / évocateurs, à partir des mêmes signaux. */
  creativeTitles: string[];
}

const MAX_CATEGORIES = 3; // meilleures catégories (l'utilisateur choisit, ex. Illustration vs BD)
const MAX_TAGS = 9;
const PER_GROUP_KEEP = 2; // jusqu'à 2 tags par dimension → plus de suggestions

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function buildTitles(categories: CategorySuggestion[], tags: TagSuggestion[]): string[] {
  // Meilleur tag de chaque dimension → composition d'un descriptif français.
  const top = (g: string) => tags.find((t) => t.group === g)?.label;
  const subj = top("sujet");
  const col = top("couleur");
  const comp = top("composition");
  const tech = top("technique");
  const sub = categories[0]?.subcategory;
  const inSub = (x?: string) => !!x && !!sub && sub.toLowerCase().includes(x.toLowerCase());
  const out: string[] = [];
  // 1) Descriptif riche à partir des dimensions concrètes (sujet/composition/couleur).
  const dims = [subj, comp, col].filter(Boolean);
  if (dims.length >= 2) out.push(cap(dims.join(" ")));
  // 2) Angle technique : « Photographie — intérieur ».
  if (tech && subj && !inSub(tech)) out.push(`${cap(tech)} — ${subj}`);
  // 3) Sous-catégorie enrichie d'un tag NON redondant (évite « Illustration illustration »).
  const enrich = [col, comp, subj].find((x) => x && !inSub(x));
  if (sub && enrich) out.push(`${cap(sub)} ${enrich}`);
  // 4) Replis simples.
  if (sub) out.push(cap(sub));
  if (subj) out.push(cap(subj));
  return [...new Set(out.filter(Boolean))].slice(0, 3);
}

// Fragments ÉVOCATEURS par tag (pas de vrai LLM en local → banque de titres
// « créatifs » associée aux tags dominants ; l'utilisateur choisit/édite).
const CREATIVE_BY_TAG: Record<string, string[]> = {
  "coloré": ["Explosion de couleurs", "Kaléidoscope", "Chromies"],
  "pastel": ["Douceur pastel", "Rêverie tendre", "Guimauve"],
  "noir et blanc": ["Clair-obscur", "En sourdine", "Gris sur gris"],
  "monochrome": ["Ton sur ton", "Camaïeu"],
  "tons chauds": ["Braise", "Heure dorée"],
  "tons froids": ["Fraîcheur bleutée", "Grand bleu"],
  "sépia": ["Souvenir jauni", "Vieux papier"],
  "vintage": ["Nostalgie", "Écho rétro", "Machine à remonter"],
  "géométrique": ["Géométries", "Lignes & formes", "Angles droits"],
  "minimaliste": ["Épure", "Le vide habité", "Presque rien"],
  "abstrait": ["Abstraction", "Sans titre", "Formes libres"],
  "motif": ["Ritournelle", "Trame", "En boucle"],
  "symétrique": ["Miroir", "Parfait équilibre"],
  "gros plan": ["Au plus près", "Détail"],
  "onirique": ["Songe éveillé", "Rêverie", "Hors du temps"],
  "sombre": ["Pénombre", "Basse lumière", "Ombres portées"],
  "lumineux": ["Pleine lumière", "Éclat", "À contre-jour"],
  "contrasté": ["Tension", "Ombre & lumière", "Coup d'éclat"],
  "doux": ["Tout en douceur", "Feutré"],
  "nuit": ["Nocturne", "Sous la lune", "Après minuit"],
  "brut": ["Sans filtre", "À vif", "Béton"],
  "portrait": ["Face à face", "Le regard", "Présence"],
  "personnage": ["Présence", "En scène", "Silhouettes"],
  "nature": ["Éclosion", "Nature vive", "Grand air"],
  "paysage": ["Horizon", "Grand large", "Point de fuite"],
  "urbain": ["Béton & bruit", "Rumeur urbaine", "Bitume"],
  "architecture": ["Lignes de fuite", "Béton & verre"],
  "intérieur": ["Huis clos", "Entre quatre murs"],
  "textile": ["Étoffe", "Au fil"],
  "eau": ["Reflets", "Ondes", "À fleur d'eau"],
  "ciel": ["Tête en l'air", "Nuages"],
  "typographie": ["Lettres capitales", "Bouche à mot", "Caractères"],
  "illustration": ["Coup de crayon", "Trait pour trait"],
  "3D": ["Relief", "Volumes"],
  "collage": ["Bric-à-brac", "Pièces rapportées"],
};

function buildCreativeTitles(categories: CategorySuggestion[], tags: TagSuggestion[]): string[] {
  const out: string[] = [];
  // 1) Puise dans les banques des tags dominants (dans l'ordre de pertinence).
  for (const t of tags) {
    const pool = CREATIVE_BY_TAG[t.label];
    if (pool) out.push(...pool);
    if (out.length >= 8) break;
  }
  // 2) Compléments par combinaison si trop peu.
  const labels = tags.map((t) => t.label);
  if (labels[0] && labels[1]) out.push(`${cap(labels[0])} & ${labels[1]}`);
  if (labels[0]) out.push(`${cap(labels[0])}, encore`);
  const sub = categories[0]?.subcategory;
  if (sub) out.push(`${cap(sub)}, variation`);
  return [...new Set(out.filter(Boolean))].slice(0, 3);
}

// `scores` = cosinus par libellé, aligné sur flatConcepts() (même ordre que les
// embeddings pré-calculés).
function mapResult(scores: number[]): ImageAnalysis {
  const flats = flatConcepts();

  // Catégories : proches de la meilleure catégorie.
  // Les 2 meilleures catégories (classement SigLIP fiable ; l'utilisateur choisit).
  const categories = flats
    .map((c, i) => (c.kind === "category" ? { category: c.category, subcategory: c.subcategory, score: scores[i] } : null))
    .filter((x): x is CategorySuggestion => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CATEGORIES);

  // Tags : LE MEILLEUR de chaque dimension (couleur, technique, composition,
  // sujet, ambiance) → toujours ~5 suggestions DIVERSES, classées par pertinence.
  // Pas de seuil relatif sur le score : les cosinus SigLIP peuvent être négatifs,
  // un seuil multiplicatif s'effondrait alors (→ 0 tag, retour 2026-07-19). On
  // s'appuie sur le CLASSEMENT (fiable) et l'utilisateur décoche l'inutile.
  const byGroup = new Map<string, TagSuggestion[]>();
  flats.forEach((c, i) => {
    if (c.kind === "tag") {
      const arr = byGroup.get(c.group) ?? [];
      arr.push({ label: c.label, score: scores[i], group: c.group });
      byGroup.set(c.group, arr);
    }
  });
  const topTags: TagSuggestion[] = [];
  for (const arr of byGroup.values()) {
    arr.sort((a, b) => b.score - a.score);
    topTags.push(...arr.slice(0, PER_GROUP_KEEP));
  }
  topTags.sort((a, b) => b.score - a.score);
  const tags = topTags.slice(0, MAX_TAGS);

  return { categories, tags, titles: buildTitles(categories, tags), creativeTitles: buildCreativeTitles(categories, tags) };
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
      const data = e.data as { id: number; type: string; progress?: AnalysisProgress; result?: { scores: number[] }; message?: string };
      if (data.id !== id) return;
      if (data.type === "progress" && data.progress) onProgress?.(data.progress);
      else if (data.type === "done" && data.result) { cleanup(); resolve(mapResult(data.result.scores)); }
      else if (data.type === "error") { cleanup(); reject(new Error(data.message ?? "worker error")); }
    };
    const onError = (err: ErrorEvent) => { cleanup(); reject(err.error ?? new Error(err.message)); };
    const cleanup = () => { w.removeEventListener("message", onMessage); w.removeEventListener("error", onError); };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, imageUrl });
  });
}

// ── Repli thread principal (SigLIP vision-only, mêmes embeddings pré-calculés) ─
interface SiglipLoaded {
  model: (inputs: Record<string, unknown>) => Promise<{ pooler_output: { tolist(): number[][] } }>;
  processor: (img: unknown) => Promise<Record<string, unknown>>;
  RawImage: { read(url: string): Promise<unknown> };
}
let siglipPromise: Promise<SiglipLoaded> | null = null;
async function analyzeOnMainThread(imageUrl: string, onProgress?: (p: AnalysisProgress) => void): Promise<ImageAnalysis> {
  if (!siglipPromise) {
    siglipPromise = (async () => {
      const { SiglipVisionModel, AutoProcessor, RawImage } = await import("@huggingface/transformers");
      const id = "Xenova/siglip-base-patch16-224";
      const progress_callback = (p: { status?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.loaded && p.total) {
          onProgress?.({ phase: "downloading", loadedMB: Math.round(p.loaded / 1048576), totalMB: Math.round(p.total / 1048576) });
        }
      };
      const [model, processor] = await Promise.all([
        SiglipVisionModel.from_pretrained(id, { progress_callback }),
        AutoProcessor.from_pretrained(id),
      ]);
      return { model, processor, RawImage } as unknown as SiglipLoaded;
    })();
    siglipPromise.catch(() => { siglipPromise = null; });
  }
  const { model, processor, RawImage } = await siglipPromise;
  onProgress?.({ phase: "classifying" });
  const image = await RawImage.read(imageUrl);
  const inputs = await processor(image);
  const out = await model(inputs);
  const emb = out.pooler_output.tolist()[0];
  return mapResult(scoreImageEmbedding(emb));
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

// SÉRIALISATION : la session ONNX n'est PAS ré-entrante — deux `model()`
// concurrents la corrompent. Or la visionneuse monte DEUX panneaux
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
