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

// Débit cible du MediaRecorder — voix, pas musique, mais sans ce réglage
// EXPLICITE certains navigateurs (Chrome/Android en tête) retombent sur un
// débit Opus par défaut très bas (profil VOIP basse bande passante), d'où
// un rendu nettement moins bon que sur Safari/iOS où l'encodeur AAC par
// défaut est déjà généreux. 128 kbps mono est large pour de la voix et reste
// très en dessous du plafond serveur (15 Mo/clip, voir QUOTA.MAX_AUDIO_SIZE_BYTES).
export const AUDIO_BITRATE = 128_000;

// Contraintes micro explicites. DÉCISION QUALITÉ (2026-07-19, retour terrain
// Android « on dirait le micro de communication ») : on DÉSACTIVE le triptyque
// de traitement vocal (echoCancellation / noiseSuppression / autoGainControl).
// Ces filtres font basculer Android/Chrome sur la source « communication »
// (VOICE_COMMUNICATION, chaîne DSP téléphonie → bande étroite, pompage AGC,
// suppression agressive qui étouffe l'ambiance et la musique d'une expo). Off,
// le navigateur prend la source « média/non traitée », bien plus fidèle. On
// vise 48 kHz (natif Opus). Contrepartie assumée : un peu plus d'écho/bruit
// ambiant capté — c'est justement ce qu'on veut préserver pour un mémo de
// visite, pas un appel « nettoyé ».
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
};

/** Crée un MediaRecorder avec un débit explicite (voir AUDIO_BITRATE) — évite
 *  le double réglage dupliqué entre les différents points d'enregistrement. */
export function createAudioRecorder(stream: MediaStream, mimeType?: string): MediaRecorder {
  const options: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITRATE };
  if (mimeType) options.mimeType = mimeType;
  return new MediaRecorder(stream, options);
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
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
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
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
  let stopped = false;
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onUpdate((finalText + interim).trim());
  };
  // Erreurs (no-speech, aborted…) : non fatales, on garde ce qu'on a. Sur
  // "not-allowed"/"service-not-allowed" on abandonne (sinon boucle de relance).
  recognition.onerror = (e) => {
    if (e?.error === "not-allowed" || e?.error === "service-not-allowed") stopped = true;
  };
  // ANDROID : `continuous` n'est PAS respecté — la reconnaissance s'arrête
  // après chaque silence (`onend`). Sans relance on ne capte que la 1re
  // phrase. On la RELANCE tant que l'enregistrement tourne → transcription
  // réellement continue pendant qu'on parle (petit délai anti-boucle).
  recognition.onend = () => {
    if (stopped) return;
    setTimeout(() => {
      if (stopped) return;
      try { recognition.start(); } catch { /* déjà relancée */ }
    }, 250);
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try { recognition.stop(); } catch { /* déjà arrêtée */ }
      return finalText.trim();
    },
  };
}
