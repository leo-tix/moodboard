"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import {
  pickSupportedAudioMimeType,
  requestMicrophone,
  startLiveTranscription,
  createAudioRecorder,
  type LiveTranscriber,
} from "@/lib/audio/recorder";
import { transcribeBlobLocally, type TranscribeProgress } from "@/lib/audio/transcribe";
import type { WordTiming } from "@/lib/audio/wordTimings";
import { enqueueCapture } from "@/lib/offline/outbox";
import { VoiceWaveform } from "@/components/visits/VoiceWaveform";
import { AudioPlayer } from "@/components/visits/AudioPlayer";

// Barre de progression de la transcription Whisper — affichée pendant tout le
// traitement pour que l'utilisateur sache OÙ on en est. Deux régimes :
//  · « downloading » (1er usage, ~80 Mo) : barre DÉTERMINÉE (Mo réels) — cette
//    phase est du réseau async, le thread principal est libre, la barre avance.
//  · « decoding » / « transcribing » : barre INDÉTERMINÉE en CSS pur
//    (mb-progress-sweep) — le calcul WASM fige le thread JS, seule une
//    animation compositeur (transform) continue de défiler pendant le gel.
function TranscribeProgressBar({ progress }: { progress: TranscribeProgress }) {
  const pct =
    progress.phase === "downloading" && progress.totalMB
      ? Math.min(100, Math.round(((progress.loadedMB ?? 0) / progress.totalMB) * 100))
      : null;
  const label =
    progress.phase === "downloading"
      ? "Téléchargement du modèle (1re fois)"
      : progress.phase === "decoding"
        ? "Préparation de l'audio…"
        : "Transcription en cours…";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" strokeWidth={2.2} />
          {label}
        </span>
        {pct !== null && (
          <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
            {progress.loadedMB ?? 0}/{progress.totalMB} Mo · {pct}%
          </span>
        )}
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
        {pct !== null ? (
          <div
            className="h-full rounded-full bg-[var(--text-primary)] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="mb-progress-sweep absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--text-primary)]" />
        )}
      </div>
    </div>
  );
}

const MIC_ONBOARD_KEY = "mb-mic-onboarded";

export interface CreatedAudioBlock {
  id: string;
  storageKey: string;
  durationSec: number | null;
  transcript: string | null;
  /** Timings par mot (Whisper) — pour la surbrillance karaoke synchronisée. */
  wordTimings?: WordTiming[] | null;
  /** Renvoyés uniquement par /api/moodboards/[id]/audio pour l'instant — le
   *  carnet de visite affiche l'auteur autrement (mono-utilisateur par
   *  visite, pas de bloc individuel). */
  authorName?: string | null;
  authorImage?: string | null;
}

type MemoPhase =
  | { step: "idle" }
  | { step: "onboarding" }
  | { step: "recording"; startedAt: number }
  | { step: "preview"; blob: Blob; durationSec: number }
  | { step: "saving" };

interface VoiceMemoRecorderProps {
  /** Endpoint d'upload — `/api/visits/[id]/audio` ou `/api/moodboards/[id]/audio`
   *  (généralisé 2026-07-14 pour être partagé par le carnet de visite ET les
   *  planches moodboard, mémo vocal "unifié" entre les deux). */
  uploadUrl: string;
  /** File d'attente hors ligne (IndexedDB) — spécifique au carnet de visite
   *  pour l'instant, aucun équivalent construit côté planches (édition
   *  moodboard suppose déjà une connexion active). `null`/absent = hors
   *  ligne affiché comme une erreur simple plutôt que mis en file. */
  offlineQueue?: { visitId: string } | null;
  /** Feuille ouverte — l'enregistrement démarre automatiquement à l'ouverture
   *  (onboarding la toute première fois, sinon directement). */
  open: boolean;
  onClose: () => void;
  onCreated: (audio: CreatedAudioBlock) => void;
  /** Message transitoire (ex. mise en file hors ligne) — optionnel, le
   *  composant reste utilisable sans (l'appelant ignore juste l'info). */
  onInfo?: (message: string) => void;
  /** Libellé du bouton de validation — "Ajouter au carnet" par défaut,
   *  "Ajouter à la planche" côté moodboard. */
  saveLabel?: string;
}

// Popup UNIQUE de prise de note audio — waveform réactive + transcription en
// direct (Web Speech) + repli transcription locale (Whisper WASM) + file
// d'attente hors ligne (carnet de visite uniquement). Initialement propre au
// FAB de capture du carnet (appui long), désormais partagée par TOUS les
// points d'entrée du carnet (menu "+ Bloc", "⋯ Insérer après", pile de
// colonne) ET par l'outil "Mémo audio" des planches moodboard (2026-07-14) —
// une seule et même expérience d'enregistrement partout dans l'app.
export function VoiceMemoRecorder({ uploadUrl, offlineQueue, open, onClose, onCreated, onInfo, saveLabel = "Ajouter au carnet" }: VoiceMemoRecorderProps) {
  const [memo, setMemo] = useState<MemoPhase>({ step: "idle" });
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [transcript, setTranscript] = useState("");
  // Timings par mot produits par Whisper — persistés avec le mémo pour la
  // surbrillance karaoke synchronisée. Invalidés (null) dès que l'utilisateur
  // édite le transcript à la main (les mots ne correspondent plus).
  const [wordTimings, setWordTimings] = useState<WordTiming[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [speechAvailable, setSpeechAvailable] = useState<boolean | null>(null);
  const [transcribing, setTranscribing] = useState<TranscribeProgress | null>(null);
  // Tactile (mobile) : on NE lance PAS la transcription live (Web Speech). Sur
  // Android elle ouvre un 2e accès micro (« Reconnaissance vocale de Google »)
  // qui se dispute la puce micro avec l'enregistrement → mauvais micro /
  // qualité dégradée (capture 2026-07-19). La transcription est faite après,
  // via Whisper (auto). Sur desktop (souris), pas ce conflit → live conservée.
  const isTouch = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriberRef = useRef<LiveTranscriber | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (memo.step !== "recording") return;
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [memo.step]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && memo.step === "recording") stopMemo();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo.step]);

  // Pipeline « occupé » : enregistrement, transcription (Whisper) ou upload en
  // cours. Sert au Wake Lock, au verrou de sortie et au garde beforeunload.
  const busy = memo.step === "recording" || memo.step === "saving" || transcribing !== null;
  // Travail non sauvegardé présent (l'aperçu contient un clip pas encore
  // enregistré) — la feuille ne doit pas se fermer par un tap à côté.
  const hasUnsaved = memo.step === "recording" || memo.step === "preview" || memo.step === "saving";

  // WAKE LOCK — empêche l'écran de s'éteindre pendant tout le pipeline actif
  // (demande 2026-07-19). Un écran qui s'endort couperait l'enregistrement
  // (Android suspend le micro) ET pourrait interrompre la transcription WASM /
  // l'upload. Best-effort : l'API n'existe pas partout (Safari < 16.4…), on
  // ignore silencieusement. Le lock saute quand l'onglet passe en arrière-plan
  // → on le reprend au retour au premier plan tant que le pipeline tourne.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!busy) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return;
    let cancelled = false;
    const acquire = async () => {
      try {
        const sentinel = await nav.wakeLock!.request("screen");
        if (cancelled) { sentinel.release().catch(() => {}); return; }
        wakeLockRef.current = sentinel;
      } catch { /* refusé / non supporté */ }
    };
    const onVis = () => { if (!document.hidden && !wakeLockRef.current) acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [busy]);

  // Garde beforeunload — un rafraîchissement / fermeture d'onglet avec un mémo
  // non enregistré affiche l'avertissement natif du navigateur (surtout utile
  // sur desktop ; sur mobile le verrou de fermeture de la feuille prend le relais).
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsaved]);

  // Démarre l'enregistrement sur un flux déjà acquis (+ transcription live).
  const startRecorderOnStream = (stream: MediaStream) => {
    const mimeType = pickSupportedAudioMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = createAudioRecorder(stream, mimeType);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("Format d'enregistrement non pris en charge par ce navigateur.");
      setMemo({ step: "idle" });
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (chunksRef.current.length === 0) {
        setMemo({ step: "idle" });
        setError("Aucun son capté — réessaie l'enregistrement.");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      setMemo({ step: "preview", blob, durationSec });
    };
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          try { recorderRef.current.stop(); } catch { /* déjà arrêté */ }
        }
      };
    });
    recorder.onerror = () => {
      transcriberRef.current?.stop();
      transcriberRef.current = null;
      stream.getTracks().forEach((t) => t.stop());
      setError("Erreur d'enregistrement — réessaie.");
      setMemo({ step: "idle" });
    };

    setTranscript("");
    setWordTimings(null);
    startedAtRef.current = Date.now();
    setElapsed(0);
    recorder.start();
    setMemo({ step: "recording", startedAt: startedAtRef.current });
    setSpeechAvailable(null);
    if (isTouch) {
      // Mobile : PAS de Web Speech (2e accès micro qui casse le routage/qualité).
      // Transcription faite après, via Whisper (auto).
      setSpeechAvailable(false);
    } else {
      window.setTimeout(() => {
        if (recorderRef.current === recorder && recorder.state === "recording") {
          transcriberRef.current = startLiveTranscription(setTranscript);
          setSpeechAvailable(transcriberRef.current !== null);
        }
      }, 200);
    }
  };

  const beginRecording = async () => {
    localStorage.setItem(MIC_ONBOARD_KEY, "1");
    const mic = await requestMicrophone();
    if (!mic.ok) { setError(mic.error); setMemo({ step: "idle" }); return; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = mic.stream;
    setMicStream(mic.stream);
    startRecorderOnStream(mic.stream);
  };

  const startMemo = async () => {
    setError(null);
    if (!localStorage.getItem(MIC_ONBOARD_KEY)) {
      setMemo({ step: "onboarding" });
      return;
    }
    await beginRecording();
  };

  // Démarre automatiquement dès l'ouverture — ouvrir cette popup EST déjà le
  // geste "je veux enregistrer maintenant" (appui long comme clic sur
  // "Audio" dans un menu), pas besoin d'un tap "Démarrer" supplémentaire.
  useEffect(() => {
    if (open && memo.step === "idle") startMemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stopMemo = () => {
    const finalText = transcriberRef.current?.stop() ?? "";
    if (finalText) setTranscript(finalText);
    transcriberRef.current = null;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      if (memo.step === "recording") {
        setError("L'enregistrement s'est arrêté de façon inattendue — réessaie.");
        setMemo({ step: "idle" });
      }
      return;
    }
    try {
      recorder.stop();
    } catch {
      setError("Erreur lors de l'arrêt de l'enregistrement.");
      setMemo({ step: "idle" });
    }
  };

  const cancelMemo = () => {
    transcriberRef.current?.stop();
    transcriberRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setMemo({ step: "idle" });
    setTranscript("");
    setWordTimings(null);
    setError(null);
    onClose();
  };

  const transcribeMemo = async () => {
    if (memo.step !== "preview" || transcribing) return;
    setError(null);
    setTranscribing({ phase: "decoding" });
    try {
      const { text, words } = await transcribeBlobLocally(memo.blob, setTranscribing);
      if (text) {
        setTranscript(text);
        setWordTimings(words.length > 0 ? words : null);
      } else setError("Rien à transcrire (silence ou parole non détectée).");
    } catch (err) {
      const detail = err instanceof Error ? ` (${err.message.slice(0, 120)})` : "";
      setError(`Transcription impossible${detail} — le mémo reste enregistrable tel quel.`);
    } finally {
      setTranscribing(null);
    }
  };

  // Transcription AUTOMATIQUE dès l'aperçu (demande 2026-07-19). Utile surtout
  // sur mobile où la transcription live est indisponible (iOS) ou incompatible
  // avec l'enregistrement haute qualité (Android). Sautée si une transcription
  // live a déjà rempli le champ (desktop) ou si l'utilisateur a déjà tapé.
  const autoTranscribedRef = useRef(false);
  useEffect(() => {
    if (memo.step !== "preview") { autoTranscribedRef.current = false; return; }
    if (autoTranscribedRef.current || transcript.trim() || transcribing) return;
    autoTranscribedRef.current = true;
    void transcribeMemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo.step]);

  const saveMemo = async () => {
    if (memo.step !== "preview") return;
    const { blob, durationSec } = memo;
    const ext = blob.type.split(";")[0].split("/")[1] || "webm";
    const filename = `memo-${Date.now()}.${ext}`;
    const cleanTranscript = transcript.trim() || undefined;
    // Timings envoyés seulement si toujours cohérents avec le transcript final
    // (l'édition manuelle les met déjà à null) ET qu'il reste un transcript.
    const timings = cleanTranscript && wordTimings && wordTimings.length > 0 ? wordTimings : undefined;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (offlineQueue) {
        await enqueueCapture({ kind: "memo", visitId: offlineQueue.visitId, blob, filename, durationSec, transcript: cleanTranscript, wordTimings: timings });
        setMemo({ step: "idle" });
        setTranscript("");
        setWordTimings(null);
        onInfo?.("Mémo en attente de connexion — envoi automatique au retour du réseau.");
        onClose();
      } else {
        // Pas de file d'attente hors ligne pour ce contexte (planches) — le
        // mémo reste dans l'aperçu, rien n'est perdu, mais pas d'envoi
        // silencieux différé possible.
        setError("Hors ligne — connexion requise pour enregistrer ce mémo.");
      }
      return;
    }

    setMemo({ step: "saving" });
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", blob, filename);
      fd.append("durationSec", String(durationSec));
      if (cleanTranscript) fd.append("transcript", cleanTranscript);
      if (timings) fd.append("wordTimings", JSON.stringify(timings));
      const res = await fetch(uploadUrl, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'envoi du mémo");
        setMemo({ step: "preview", blob, durationSec });
        return;
      }
      setMemo({ step: "idle" });
      setTranscript("");
      setWordTimings(null);
      onCreated({
        id: data.id,
        storageKey: data.storageKey,
        durationSec: data.durationSec,
        transcript: data.transcript ?? null,
        wordTimings: (data.wordTimings as WordTiming[] | null) ?? timings ?? null,
        authorName: data.authorName ?? null,
        authorImage: data.authorImage ?? null,
      });
      onClose();
    } catch {
      if (offlineQueue) {
        await enqueueCapture({ kind: "memo", visitId: offlineQueue.visitId, blob, filename, durationSec, transcript: cleanTranscript, wordTimings: timings });
        setMemo({ step: "idle" });
        setTranscript("");
        setWordTimings(null);
        onInfo?.("Réseau indisponible — mémo mis en file, envoi automatique dès que possible.");
        onClose();
      } else {
        setError("Réseau indisponible — réessaie.");
        setMemo({ step: "preview", blob, durationSec });
      }
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const previewBlob = memo.step === "preview" ? memo.blob : null;
  const previewDurationSec = memo.step === "preview" ? memo.durationSec : null;
  const previewUrl = useMemo(() => (previewBlob ? URL.createObjectURL(previewBlob) : null), [previewBlob]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  if (typeof document === "undefined") return null;

  // Ni AnimatePresence ni motion (initial/animate) : les deux ont montré un
  // comportement non-fiable ici — AnimatePresence empêchait carrément la
  // fermeture (feuille bloquée à l'écran, `open=false` confirmé côté état
  // React mais jamais reflété au DOM), et l'anime d'entrée motion.div
  // (initial→animate) restait bloquée à mi-course (feuille visible à moitié
  // hors écran, cachant potentiellement "Activer le micro"). Un rendu
  // conditionnel simple est display:none/block immédiat, sans ambiguïté —
  // fiabilité > joliesse pour ce popup critique (bugs remontés 2026-07-14).
  return createPortal(
    <>
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-[70]"
            // Non-fermable par tap à côté dès qu'un enregistrement existe
            // (enregistrement / aperçu / transcription / upload) : évite de
            // perdre le mémo par mégarde. On ne peut sortir que par « Annuler ».
            onClick={hasUnsaved ? undefined : cancelMemo}
          />
          <div
            className="fixed inset-x-0 bottom-0 z-[71] bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl p-5 md:max-w-md md:mx-auto md:rounded-2xl md:bottom-6"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
            {/* Échec avant même le début de l'enregistrement (permission
                refusée, format non supporté, rien capté…) — reste affiché
                DANS la feuille plutôt que de fermer silencieusement, quel
                que soit l'appelant (FAB, menu "+", pile de colonne). */}
            {memo.step === "idle" && error && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-[var(--text-primary)]">Mémo vocal</p>
                <p className="text-sm text-red-400 leading-relaxed">{error}</p>
                <div className="flex gap-2">
                  <button
                    onClick={cancelMemo}
                    className="flex-1 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] border border-[var(--border-default)]"
                  >
                    Fermer
                  </button>
                  <button
                    onClick={() => beginRecording()}
                    className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-base)]"
                  >
                    Réessayer
                  </button>
                </div>
              </div>
            )}

            {memo.step === "onboarding" && (
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-xl">🎙</div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Mémos vocaux</p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                    Dicte tes impressions pendant la visite : le mémo est enregistré et transcrit
                    en note directement dans le carnet. Le navigateur va demander l&apos;accès au micro.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={cancelMemo}
                    className="flex-1 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] border border-[var(--border-default)]"
                  >
                    Plus tard
                  </button>
                  <button
                    onClick={() => beginRecording()}
                    className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-base)]"
                  >
                    Activer le micro
                  </button>
                </div>
              </div>
            )}

            {memo.step === "recording" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Enregistrement…</p>
                  <span className="ml-auto text-sm text-[var(--text-tertiary)] tabular-nums">{fmt(elapsed)}</span>
                </div>
                <VoiceWaveform stream={micStream} className="w-full h-16" />
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed min-h-[3rem] max-h-32 overflow-y-auto">
                  {transcript || (
                    <span className="text-[var(--text-tertiary)] italic">
                      {isTouch
                        ? "La transcription est générée à la fin de l'enregistrement."
                        : speechAvailable === false
                          ? "Transcription non disponible sur ce navigateur — le mémo sera enregistré tel quel."
                          : "La transcription apparaît ici…"}
                    </span>
                  )}
                </p>
                <button
                  onClick={stopMemo}
                  className="w-full py-3 rounded-lg text-sm font-medium bg-red-500/15 text-red-400 border border-red-500/30"
                >
                  ⏹ Terminer le mémo
                </button>
              </div>
            )}

            {(memo.step === "preview" || memo.step === "saving") && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-[var(--text-primary)]">Mémo vocal</p>
                {/* Lecteur custom dans notre DA (waveform réactive) au lieu du
                    <audio controls> natif de Chrome (barre blanche + kebab).
                    Écoutable PENDANT la transcription : le player est monté
                    tout du long — l'audio joue même si le calcul WASM fige
                    brièvement l'UI (le fil audio est séparé du fil JS). */}
                {previewUrl && (
                  <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-3 py-2.5">
                    <AudioPlayer src={previewUrl} durationSec={previewDurationSec} />
                  </div>
                )}
                <textarea
                  value={transcript}
                  onChange={(e) => { setTranscript(e.target.value); setWordTimings(null); }}
                  disabled={memo.step === "saving"}
                  rows={3}
                  placeholder="Transcription (modifiable, ou vide)…"
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)] resize-y placeholder:text-[var(--text-tertiary)] disabled:opacity-60"
                />
                {/* Transcription EN COURS → barre de progression (où on en est).
                    Sinon, si le champ est vide → bouton pour (re)lancer à la main. */}
                {memo.step === "preview" && transcribing !== null && (
                  <TranscribeProgressBar progress={transcribing} />
                )}
                {/* Upload EN COURS → barre indéterminée + libellé clair : l'action
                    « travaille », ne quitte pas (la feuille est déjà verrouillée). */}
                {memo.step === "saving" && (
                  <div className="space-y-1.5">
                    <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <Loader2 size={12} className="animate-spin" strokeWidth={2.2} />
                      Enregistrement du mémo…
                    </span>
                    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
                      <div className="mb-progress-sweep absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--text-primary)]" />
                    </div>
                  </div>
                )}
                {memo.step === "preview" && transcribing === null && !transcript.trim() && (
                  <button
                    onClick={transcribeMemo}
                    className="w-full py-2 rounded-lg text-xs text-[var(--text-secondary)] border border-dashed border-[var(--border-default)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
                  >
                    ✎ Transcrire ce mémo (local, ~80 Mo au 1er usage)
                  </button>
                )}
                {error && <p className="text-xs text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={cancelMemo}
                    disabled={memo.step === "saving"}
                    className="flex-1 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] border border-[var(--border-default)] disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={saveMemo}
                    disabled={memo.step === "saving"}
                    className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-60"
                  >
                    {memo.step === "saving" ? "Envoi…" : saveLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>,
    document.body,
  );
}
