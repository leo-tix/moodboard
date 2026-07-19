// Transcription locale d'un clip déjà enregistré — Whisper (base, quantifié)
// via transformers.js en WASM, entièrement dans le navigateur. Raison d'être :
// la Web Speech API est indisponible en PWA iOS ET inutilisable pendant
// l'enregistrement haute qualité sur Android (elle réclamerait le micro en
// mode « communication » dégradé) ; la décision produit exclut toute API IA
// externe. Le modèle (~200 Mo, variante _timestamped) est téléchargé au premier usage puis mis en
// cache par transformers.js (Cache Storage) — chargements suivants immédiats.
//
// QUALITÉ (retour 2026-07-19 « transcriptions vraiment pas bonnes ») : passé de
// whisper-tiny à whisper-BASE (nettement plus fidèle en français, ~2× plus lourd
// mais reste raisonnable sur mobile), + DÉCOUPAGE `chunk_length_s` — sans lui,
// tout mémo de plus de 30 s (fenêtre native de Whisper) était tronqué/incohérent.
//
// WEB WORKER (2026-07-19) : l'inférence tourne dans lib/audio/whisper.worker.ts
// (thread séparé) pour NE PAS figer l'UI — l'utilisateur continue à manipuler le
// carnet pendant que le mémo est transcrit en tâche de fond. Le décodage audio
// (Web Audio) reste sur le thread principal (indisponible en worker), seul le
// Float32Array rééchantillonné est transféré. Repli automatique sur le thread
// principal si la création du worker échoue (vieux bundler, environnement sans
// module workers) — l'UI se fige alors quelques secondes, l'ancien comportement.
//
// Whisper attend du PCM mono 16 kHz en Float32Array — on décode le blob via
// Web Audio (chaque plateforme sait décoder SES propres enregistrements :
// m4a sur iOS, webm sur Chrome) puis on ré-échantillonne via
// OfflineAudioContext.

export interface TranscribeProgress {
  phase: "decoding" | "downloading" | "transcribing";
  /** Téléchargement du modèle uniquement */
  loadedMB?: number;
  totalMB?: number;
}

/** Timing d'un mot transcrit (secondes) — pour la surbrillance karaoke synchro. */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptResult {
  text: string;
  /** Timings par mot si le modèle a pu les produire, sinon [] (repli estimation). */
  words: WordTiming[];
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
  }
) => Promise<{ text: string; chunks?: AsrChunk[] } | { text: string }[]>;

let asrPromise: Promise<AsrPipeline> | null = null;

function getAsr(onProgress?: (p: TranscribeProgress) => void): Promise<AsrPipeline> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      // Variante « _timestamped » : MÊMES poids que whisper-base, mais export
      // ONNX AVEC les sorties de cross-attention. Indispensable pour les
      // timings PAR MOT (return_timestamps:"word") : transformers.js les
      // reconstruit par DTW sur les cross-attentions — l'export standard
      // whisper-base ne les expose pas, donc les timings échouaient
      // silencieusement (retour 2026-07-19 « rythme toujours approximatif » →
      // repli permanent sur l'estimation). Qualité de transcription identique.
      const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base_timestamped", {
        // q8 uniforme échoue à la création de session ONNX en WASM
        // ("TransposeDQWeightsForMatMulNBits") — combinaison reprise de la
        // démo whisper officielle de transformers.js.
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        progress_callback: (p: { status?: string; loaded?: number; total?: number }) => {
          if (p.status === "progress" && p.loaded && p.total) {
            onProgress?.({
              phase: "downloading",
              loadedMB: Math.round(p.loaded / 1048576),
              totalMB: Math.round(p.total / 1048576),
            });
          }
        },
      });
      return asr as unknown as AsrPipeline;
    })();
    // Un échec de chargement ne doit pas empoisonner les tentatives suivantes
    asrPromise.catch(() => { asrPromise = null; });
  }
  return asrPromise;
}

async function blobToWhisperInput(blob: Blob): Promise<Float32Array> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const targetLength = Math.ceil(decoded.duration * 16000);
    const offline = new OfflineAudioContext(1, targetLength, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const resampled = await offline.startRendering();
    // Copie : le buffer de getChannelData appartient à l'AudioBuffer.
    return new Float32Array(resampled.getChannelData(0));
  } finally {
    try { await ctx.close(); } catch { /* déjà fermé */ }
  }
}

// ── Chemin THREAD PRINCIPAL (repli si le worker ne peut pas être créé) ───────
async function transcribeOnMainThread(audio: Float32Array, onProgress?: (p: TranscribeProgress) => void): Promise<TranscriptResult> {
  const asr = await getAsr(onProgress);
  onProgress?.({ phase: "transcribing" });
  // Laisse un frame au navigateur pour peindre l'état avant que le calcul WASM
  // ne monopolise le thread principal.
  await new Promise((r) => setTimeout(r, 50));
  // chunk_length_s : Whisper ne « voit » que 30 s à la fois — 30 s + 5 s de
  // recouvrement = transcription cohérente sur toute la durée.
  const baseOpts = { language: "french", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 } as const;
  try {
    const out = await asr(audio, { ...baseOpts, return_timestamps: "word" });
    const chunks = (!Array.isArray(out) && out.chunks) || [];
    const words: WordTiming[] = chunks
      .filter((c) => Array.isArray(c.timestamp) && c.timestamp[0] != null && c.timestamp[1] != null && String(c.text).trim().length > 0)
      .map((c) => ({ word: String(c.text), start: c.timestamp[0] as number, end: c.timestamp[1] as number }));
    const text = ((Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "").trim();
    return { text: text || words.map((w) => w.word).join("").trim(), words };
  } catch {
    const out = await asr(audio, baseOpts);
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
    return { text: text.trim(), words: [] };
  }
}

// ── Chemin WEB WORKER (par défaut) ───────────────────────────────────────────
// Worker singleton partagé (le modèle reste chargé entre deux mémos). Créé
// paresseusement ; si `new Worker` échoue (bundler/env sans module workers),
// `workerUnavailable` bascule définitivement sur le thread principal.
let worker: Worker | null = null;
let workerUnavailable = false;
let msgSeq = 0;
function getWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function transcribeInWorker(w: Worker, audio: Float32Array, onProgress?: (p: TranscribeProgress) => void): Promise<TranscriptResult> {
  const id = ++msgSeq;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { id: number; type: string; progress?: TranscribeProgress; result?: TranscriptResult; message?: string };
      if (data.id !== id) return; // multiplexage : ignore les autres mémos
      if (data.type === "progress" && data.progress) onProgress?.(data.progress);
      else if (data.type === "done" && data.result) { cleanup(); resolve(data.result); }
      else if (data.type === "error") { cleanup(); reject(new Error(data.message ?? "worker error")); }
    };
    const onError = (err: ErrorEvent) => { cleanup(); reject(err.error ?? new Error(err.message)); };
    const cleanup = () => { w.removeEventListener("message", onMessage); w.removeEventListener("error", onError); };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    // Transfert du buffer (zero-copy) — l'audio n'est plus utilisé côté principal après ça.
    w.postMessage({ id, audio }, [audio.buffer]);
  });
}

/**
 * Transcrit un clip audio localement (Whisper base _timestamped, WASM). Décode
 * l'audio sur le thread principal (Web Audio) puis délègue l'inférence à un Web
 * Worker (UI non bloquée) ; repli sur le thread principal si le worker échoue.
 * Retourne le texte + les timings PAR MOT (vides si le modèle ne les fournit pas
 * → répartition estimée côté UI).
 */
export async function transcribeBlobLocally(
  blob: Blob,
  onProgress?: (p: TranscribeProgress) => void
): Promise<TranscriptResult> {
  onProgress?.({ phase: "decoding" });
  const audio = await blobToWhisperInput(blob);

  const w = getWorker();
  if (w) {
    try {
      return await transcribeInWorker(w, audio, onProgress);
    } catch {
      // Le worker a planté (ex. import échoué à l'exécution) — on ne réessaiera
      // plus par worker et on bascule sur le thread principal pour CE mémo.
      workerUnavailable = true;
      try { worker?.terminate(); } catch { /* déjà mort */ }
      worker = null;
      // Le buffer a été transféré au worker → il faut re-décoder pour le repli.
      return transcribeOnMainThread(await blobToWhisperInput(blob), onProgress);
    }
  }
  return transcribeOnMainThread(audio, onProgress);
}
