/// <reference lib="webworker" />
// Worker de classification d'image zéro-shot (CLIP) — analyse en local, hors du
// thread principal (UI non figée), même approche que whisper.worker.ts.
// Reçoit une URL d'image + des groupes de libellés candidats, renvoie les scores.
// transformers.js sait décoder l'image dans un worker (createImageBitmap /
// OffscreenCanvas), pas besoin du DOM.

import { pipeline } from "@huggingface/transformers";

interface WorkerProgress { phase: "downloading" | "classifying"; loadedMB?: number; totalMB?: number }
type ZeroShot = (
  image: string,
  labels: string[],
  opts?: { hypothesis_template?: string },
) => Promise<{ label: string; score: number }[]>;

let clfPromise: Promise<ZeroShot> | null = null;
function getClassifier(onProgress: (p: WorkerProgress) => void): Promise<ZeroShot> {
  if (!clfPromise) {
    clfPromise = (async () => {
      const clf = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch16", {
        progress_callback: (p: { status?: string; loaded?: number; total?: number }) => {
          if (p.status === "progress" && p.loaded && p.total) {
            onProgress({ phase: "downloading", loadedMB: Math.round(p.loaded / 1048576), totalMB: Math.round(p.total / 1048576) });
          }
        },
      });
      return clf as unknown as ZeroShot;
    })();
    clfPromise.catch(() => { clfPromise = null; });
  }
  return clfPromise;
}

self.onmessage = async (
  e: MessageEvent<{ id: number; imageUrl: string; groups: Record<string, string[]>; template?: string }>,
) => {
  const { id, imageUrl, groups, template } = e.data;
  const post = (msg: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...msg });
  try {
    const clf = await getClassifier((progress) => post({ type: "progress", progress }));
    post({ type: "progress", progress: { phase: "classifying" } });
    const result: Record<string, { label: string; score: number }[]> = {};
    for (const [key, labels] of Object.entries(groups)) {
      if (!labels.length) { result[key] = []; continue; }
      result[key] = await clf(imageUrl, labels, { hypothesis_template: template ?? "{}" });
    }
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
