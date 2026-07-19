/// <reference lib="webworker" />
// Worker de classification d'image — SigLIP (nettement plus précis que CLIP sur
// le contenu créatif, benchmark 2026-07-19). Astuce clé : le vocabulaire est
// FIXE, donc ses embeddings texte sont PRÉ-CALCULÉS (siglipTextEmbeds.json). Au
// runtime on ne charge QUE l'encodeur d'image (SiglipVisionModel) et on fait un
// produit scalaire avec ces vecteurs → rapide (l'encodeur de texte, lourd, n'est
// ni téléchargé ni exécuté). Tourne hors du thread principal (UI non figée).

import { SiglipVisionModel, AutoProcessor, RawImage } from "@huggingface/transformers";
import { scoreImageEmbedding } from "./siglipEmbeds";

interface WorkerProgress { phase: "downloading" | "classifying"; loadedMB?: number; totalMB?: number }
const MODEL_ID = "Xenova/siglip-base-patch16-224";

type Loaded = {
  model: (inputs: Record<string, unknown>) => Promise<{ pooler_output: { tolist(): number[][] } }>;
  processor: (img: unknown) => Promise<Record<string, unknown>>;
};
let loadPromise: Promise<Loaded> | null = null;
function load(onProgress: (p: WorkerProgress) => void): Promise<Loaded> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const progress_callback = (p: { status?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.loaded && p.total) {
          onProgress({ phase: "downloading", loadedMB: Math.round(p.loaded / 1048576), totalMB: Math.round(p.total / 1048576) });
        }
      };
      const [model, processor] = await Promise.all([
        SiglipVisionModel.from_pretrained(MODEL_ID, { progress_callback }),
        AutoProcessor.from_pretrained(MODEL_ID),
      ]);
      return { model, processor } as unknown as Loaded;
    })();
    loadPromise.catch(() => { loadPromise = null; });
  }
  return loadPromise;
}

self.onmessage = async (e: MessageEvent<{ id: number; imageUrl: string }>) => {
  const { id, imageUrl } = e.data;
  const post = (msg: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...msg });
  try {
    const { model, processor } = await load((progress) => post({ type: "progress", progress }));
    post({ type: "progress", progress: { phase: "classifying" } });
    const image = await RawImage.read(imageUrl);
    const inputs = await processor(image);
    const out = await model(inputs);
    const emb = out.pooler_output.tolist()[0]; // [DIM]
    const scores = scoreImageEmbedding(emb); // cosinus par libellé (ordre flatConcepts)
    post({ type: "done", result: { scores } });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
