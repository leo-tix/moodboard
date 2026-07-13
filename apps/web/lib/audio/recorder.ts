// Helpers d'enregistrement micro partagés (FAB de capture mobile + toolbar
// de l'éditeur de notes) — regroupent les deux pièges plateforme rencontrés :
// getUserMedia qui échoue avec des DOMException différenciées, et
// `new MediaRecorder(stream)` sans type explicite qui plante silencieusement
// sur Safari/iOS (aucun type par défaut supporté).

/** Types tentés dans l'ordre — le premier supporté par le navigateur gagne. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function pickSupportedAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Demande l'accès micro avec des messages d'erreur exploitables en UI.
 * Retourne soit le stream, soit un message d'erreur français prêt à afficher.
 */
export async function requestMicrophone(): Promise<
  { ok: true; stream: MediaStream } | { ok: false; error: string }
> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: "Micro non disponible — HTTPS (ou localhost) requis pour enregistrer." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { ok: true, stream };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return { ok: false, error: "Permission micro refusée — autorise l'accès dans les réglages du navigateur." };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { ok: false, error: "Aucun micro détecté sur cet appareil." };
    }
    return { ok: false, error: "Micro inaccessible — vérifie les permissions du navigateur." };
  }
}

// ── Transcription locale (Web Speech API) ───────────────────────────────────
// Décision produit 2026-07-13 : transcription NAVIGATEUR uniquement (pas
// d'API IA externe — Gemini a été retiré volontairement du produit). La Web
// Speech API ne transcrit qu'EN DIRECT pendant que le micro tourne — pas de
// re-transcription possible d'un clip déjà enregistré. Support : Chrome,
// Safari (webkit prefix), pas Firefox → toujours traiter comme best-effort.

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface LiveTranscriber {
  /** Arrête la reconnaissance et retourne le texte final accumulé. */
  stop: () => string;
}

/**
 * Démarre une transcription en direct (best-effort). `onUpdate` reçoit le
 * texte courant (final + hypothèse en cours) à chaque frame de reconnaissance.
 * Retourne null si l'API n'est pas disponible sur ce navigateur.
 */
export function startLiveTranscription(onUpdate: (text: string) => void): LiveTranscriber | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = "fr-FR";
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalText = "";
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onUpdate((finalText + interim).trim());
  };
  // Erreurs (no-speech, aborted…) : non fatales, on garde ce qu'on a.
  recognition.onerror = () => {};

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      try { recognition.stop(); } catch { /* déjà arrêtée */ }
      return finalText.trim();
    },
  };
}
