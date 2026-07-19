/// <reference lib="webworker" />
// Worker de transcription Whisper — fait tourner l'inférence WASM sur un thread
// SÉPARÉ pour ne PAS figer l'UI pendant le traitement (l'utilisateur continue à
// manipuler le carnet, déplacer des tuiles… pendant que le mémo est transcrit
// en tâche de fond, 2026-07-19).
//
// Le décodage audio (blob → PCM 16 kHz) reste côté thread principal : l'API
// Web Audio (decodeAudioData / OfflineAudioContext) n'existe pas dans un Worker.
// Le worker ne reçoit QUE le Float32Array déjà rééchantillonné.
//
// Modèle _timestamped : export ONNX AVEC cross-attentions, indispensable pour
// les timings PAR MOT (voir lib/audio/transcribe.ts pour le détail).

import { pipeline } from "@huggingface/transformers";

interface WorkerProgress {
  phase: "downloading" | "transcribing";
  loadedMB?: number;
  totalMB?: number;
}
type AsrChunk = { text: string; timestamp: [number | null, number | null] };
type AsrPipeline = (
  audio: Float32Array,
  opts: {
    language: string;
    task: string;
    chunk_length_s?: number;
    stride_length_s?: number;
    return_timestamps?: boolean | "word";
  },
) => Promise<{ text: string; chunks?: AsrChunk[] } | { text: string }[]>;

let asrPromise: Promise<AsrPipeline> | null = null;
function getAsr(onProgress: (p: WorkerProgress) => void): Promise<AsrPipeline> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base_timestamped", {
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        progress_callback: (p: { status?: string; loaded?: number; total?: number }) => {
          if (p.status === "progress" && p.loaded && p.total) {
            onProgress({ phase: "downloading", loadedMB: Math.round(p.loaded / 1048576), totalMB: Math.round(p.total / 1048576) });
          }
        },
      });
      return asr as unknown as AsrPipeline;
    })();
    asrPromise.catch(() => { asrPromise = null; });
  }
  return asrPromise;
}

self.onmessage = async (e: MessageEvent<{ id: number; audio: Float32Array }>) => {
  const { id, audio } = e.data;
  const post = (msg: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...msg });
  try {
    const asr = await getAsr((progress) => post({ type: "progress", progress }));
    post({ type: "progress", progress: { phase: "transcribing" } });
    const baseOpts = { language: "french", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 } as const;
    try {
      const out = await asr(audio, { ...baseOpts, return_timestamps: "word" });
      const chunks = (!Array.isArray(out) && out.chunks) || [];
      const words = chunks
        .filter((c) => Array.isArray(c.timestamp) && c.timestamp[0] != null && c.timestamp[1] != null && String(c.text).trim().length > 0)
        .map((c) => ({ word: String(c.text), start: c.timestamp[0] as number, end: c.timestamp[1] as number }));
      const text = ((Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "").trim();
      post({ type: "done", result: { text: text || words.map((w) => w.word).join("").trim(), words } });
    } catch {
      const out = await asr(audio, baseOpts);
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
      post({ type: "done", result: { text: text.trim(), words: [] } });
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
