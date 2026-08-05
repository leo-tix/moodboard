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
  doneSec?: number;
  totalSec?: number;
}

// Fréquence d'échantillonnage imposée par Whisper (cf. blobToWhisperInput).
const SAMPLE_RATE = 16000;
// Découpage des mémos LONGS en segments traités successivement. Objectif :
// pouvoir REMONTER UNE PROGRESSION. Auparavant tout l'audio partait dans un
// unique `await asr(...)` : pour un mémo de 6:50 l'utilisateur voyait une barre
// indéterminée pendant plusieurs minutes, sans savoir si ça avançait ou si
// c'était planté (retour 2026-08-05). Segments longs (2 min) pour limiter les
// coupures en milieu de phrase, qui dégradent la qualité de Whisper.
const SEGMENT_SEC = 120;
// En dessous de ce seuil, un seul appel — comportement historique préservé
// pour les mémos courts, qui sont déjà rapides.
const SEGMENTED_ABOVE_SEC = 150;
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

const BASE_OPTS = { language: "french", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 } as const;

type Word = { word: string; start: number; end: number };

// Transcrit UN segment. `offsetSec` décale les timings pour qu'ils restent
// exprimés dans le référentiel du mémo complet (surbrillance karaoke).
// Repli sans timings si l'export mot-à-mot échoue, comme avant.
async function runSegment(asr: AsrPipeline, audio: Float32Array, offsetSec: number): Promise<{ text: string; words: Word[] }> {
  try {
    const out = await asr(audio, { ...BASE_OPTS, return_timestamps: "word" });
    const chunks = (!Array.isArray(out) && out.chunks) || [];
    const words = chunks
      .filter((c) => Array.isArray(c.timestamp) && c.timestamp[0] != null && c.timestamp[1] != null && String(c.text).trim().length > 0)
      .map((c) => ({ word: String(c.text), start: (c.timestamp[0] as number) + offsetSec, end: (c.timestamp[1] as number) + offsetSec }));
    const text = ((Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "").trim();
    return { text: text || words.map((w) => w.word).join("").trim(), words };
  } catch {
    const out = await asr(audio, BASE_OPTS);
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
    return { text: text.trim(), words: [] };
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; audio: Float32Array }>) => {
  const { id, audio } = e.data;
  const post = (msg: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id, ...msg });
  try {
    const asr = await getAsr((progress) => post({ type: "progress", progress }));
    const totalSec = audio.length / SAMPLE_RATE;

    // Mémo court : un seul appel, barre indéterminée (inchangé).
    if (totalSec <= SEGMENTED_ABOVE_SEC) {
      post({ type: "progress", progress: { phase: "transcribing" } });
      const r = await runSegment(asr, audio, 0);
      post({ type: "done", result: r });
      return;
    }

    // Mémo long : segments successifs, progression remontée après CHACUN.
    const step = SEGMENT_SEC * SAMPLE_RATE;
    const texts: string[] = [];
    const words: Word[] = [];
    for (let start = 0; start < audio.length; start += step) {
      const offsetSec = start / SAMPLE_RATE;
      post({ type: "progress", progress: { phase: "transcribing", doneSec: Math.round(offsetSec), totalSec: Math.round(totalSec) } });
      const r = await runSegment(asr, audio.subarray(start, Math.min(start + step, audio.length)), offsetSec);
      if (r.text) texts.push(r.text);
      words.push(...r.words);
    }
    post({ type: "progress", progress: { phase: "transcribing", doneSec: Math.round(totalSec), totalSec: Math.round(totalSec) } });
    post({ type: "done", result: { text: texts.join(" ").trim(), words } });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
