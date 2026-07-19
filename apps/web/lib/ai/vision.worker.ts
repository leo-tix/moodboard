/// <reference lib="webworker" />
// Worker de classification d'image zéro-shot (CLIP) — analyse locale hors du
// thread principal (UI non figée), même approche que whisper.worker.ts.
//
// PERF (retour 2026-07-19 « ça tourne en boucle » sur mobile) : on encode
// l'image UNE SEULE fois. Au lieu d'appeler le pipeline zero-shot une fois par
// groupe (→ ré-encodage de l'image à CHAQUE fois, l'étape la plus coûteuse), on
// fait UN seul forward `model({texte, image})` avec TOUS les libellés d'un coup
// → `logits_per_image` donne les similarités (échelle CLIP) pour tous les
// libellés. Le softmax PAR GROUPE est fait côté moteur (imageAnalysis.ts).

import { CLIPModel, AutoProcessor, AutoTokenizer, RawImage } from "@huggingface/transformers";

interface WorkerProgress { phase: "downloading" | "classifying"; loadedMB?: number; totalMB?: number }

const MODEL_ID = "Xenova/clip-vit-base-patch16";
type Loaded = { model: { (inputs: Record<string, unknown>): Promise<{ logits_per_image: { tolist(): number[][] } }> }; processor: (img: unknown) => Promise<Record<string, unknown>>; tokenizer: (texts: string[], opts: Record<string, unknown>) => Record<string, unknown> };

let loadPromise: Promise<Loaded> | null = null;
function load(onProgress: (p: WorkerProgress) => void): Promise<Loaded> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const progress_callback = (p: { status?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.loaded && p.total) {
          onProgress({ phase: "downloading", loadedMB: Math.round(p.loaded / 1048576), totalMB: Math.round(p.total / 1048576) });
        }
      };
      const [model, processor, tokenizer] = await Promise.all([
        CLIPModel.from_pretrained(MODEL_ID, { progress_callback }),
        AutoProcessor.from_pretrained(MODEL_ID),
        AutoTokenizer.from_pretrained(MODEL_ID),
      ]);
      return { model, processor, tokenizer } as unknown as Loaded;
    })();
    loadPromise.catch(() => { loadPromise = null; });
  }
  return loadPromise;
}

self.onmessage = async (
  e: MessageEvent<{ id: number; imageUrl: string; groups: Record<string, string[]> }>,
) => {
  const { id, imageUrl, groups } = e.data;
  const post = (msg: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...msg });
  try {
    const { model, processor, tokenizer } = await load((progress) => post({ type: "progress", progress }));
    post({ type: "progress", progress: { phase: "classifying" } });

    // Tous les libellés à plat + plages par groupe.
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
    const logits = output.logits_per_image.tolist()[0]; // [nbLibellés] — sims échelle CLIP

    const result: Record<string, { label: string; score: number }[]> = {};
    for (const [key, [start, end]] of Object.entries(ranges)) {
      result[key] = groups[key].map((label, i) => ({ label, score: logits[start + i] }));
    }
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
