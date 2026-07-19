// Transcription locale d'un clip déjà enregistré — Whisper (base, quantifié)
// via transformers.js en WASM, entièrement dans le navigateur. Raison d'être :
// la Web Speech API est indisponible en PWA iOS ET inutilisable pendant
// l'enregistrement haute qualité sur Android (elle réclamerait le micro en
// mode « communication » dégradé) ; la décision produit exclut toute API IA
// externe. Le modèle (~80 Mo) est téléchargé au premier usage puis mis en
// cache par transformers.js (Cache Storage) — chargements suivants immédiats.
//
// QUALITÉ (retour 2026-07-19 « transcriptions vraiment pas bonnes ») : passé de
// whisper-tiny à whisper-BASE (nettement plus fidèle en français, ~2× plus lourd
// mais reste raisonnable sur mobile), + DÉCOUPAGE `chunk_length_s` — sans lui,
// tout mémo de plus de 30 s (fenêtre native de Whisper) était tronqué/incohérent.
//
// Pourquoi PAS un Web Worker : `new Worker(new URL("./x.ts", import.meta.url))`
// jette de façon synchrone sous Turbopack dans ce contexte (import.meta.url
// non résolu comme attendu) — vérifié en traçant pas à pas. L'inférence
// tourne donc sur le thread principal via un import dynamique : l'UI se fige
// pendant la transcription (quelques secondes pour un mémo court), l'état
// "Transcription en cours…" l'annonce. À re-basculer en worker si le support
// bundler se clarifie.
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

type AsrPipeline = (
  audio: Float32Array,
  opts: { language: string; task: string; chunk_length_s?: number; stride_length_s?: number }
) => Promise<{ text: string } | { text: string }[]>;

let asrPromise: Promise<AsrPipeline> | null = null;

function getAsr(onProgress?: (p: TranscribeProgress) => void): Promise<AsrPipeline> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
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

/**
 * Transcrit un clip audio localement (Whisper tiny, WASM). Premier appel :
 * télécharge le modèle (~40 Mo, ensuite en cache navigateur). Lève une Error
 * avec un message affichable en cas d'échec.
 */
export async function transcribeBlobLocally(
  blob: Blob,
  onProgress?: (p: TranscribeProgress) => void
): Promise<string> {
  onProgress?.({ phase: "decoding" });
  const audio = await blobToWhisperInput(blob);

  const asr = await getAsr(onProgress);
  onProgress?.({ phase: "transcribing" });
  // Laisse un frame au navigateur pour peindre l'état "transcription en
  // cours" avant que le calcul WASM ne monopolise le thread principal.
  await new Promise((r) => setTimeout(r, 50));

  // chunk_length_s : Whisper ne « voit » que 30 s à la fois — sans découpage,
  // un mémo plus long est tronqué ou part en boucle. 30 s + 5 s de recouvrement
  // = transcription cohérente sur toute la durée.
  const out = await asr(audio, { language: "french", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
  const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
  return text.trim();
}
