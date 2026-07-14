"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  pickSupportedAudioMimeType,
  requestMicrophone,
  startLiveTranscription,
  createAudioRecorder,
  type LiveTranscriber,
} from "@/lib/audio/recorder";
import { transcribeBlobLocally, type TranscribeProgress } from "@/lib/audio/transcribe";
import { enqueueCapture } from "@/lib/offline/outbox";
import { VoiceWaveform } from "@/components/visits/VoiceWaveform";

const MIC_ONBOARD_KEY = "mb-mic-onboarded";

export interface CreatedAudioBlock {
  id: string;
  storageKey: string;
  durationSec: number | null;
  transcript: string | null;
}

type MemoPhase =
  | { step: "idle" }
  | { step: "onboarding" }
  | { step: "recording"; startedAt: number }
  | { step: "preview"; blob: Blob; durationSec: number }
  | { step: "saving" };

interface VoiceMemoRecorderProps {
  visitId: string;
  /** Feuille ouverte — l'enregistrement démarre automatiquement à l'ouverture
   *  (onboarding la toute première fois, sinon directement). */
  open: boolean;
  onClose: () => void;
  onCreated: (audio: CreatedAudioBlock) => void;
  /** Message transitoire (ex. mise en file hors ligne) — optionnel, le
   *  composant reste utilisable sans (l'appelant ignore juste l'info). */
  onInfo?: (message: string) => void;
}

// Popup UNIQUE de prise de note audio du carnet — waveform réactive +
// transcription en direct (Web Speech) + repli transcription locale
// (Whisper WASM) + file d'attente hors ligne. Initialement propre au FAB de
// capture (appui long), désormais partagé par TOUS les points d'entrée
// (menu "+ Bloc", "⋯ Insérer après", pile de colonne) — demande utilisateur
// 2026-07-14 : une seule et même expérience d'enregistrement partout, plus
// de popover basique à côté (ancien AudioRecorderInline, supprimé).
export function VoiceMemoRecorder({ visitId, open, onClose, onCreated, onInfo }: VoiceMemoRecorderProps) {
  const [memo, setMemo] = useState<MemoPhase>({ step: "idle" });
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [speechAvailable, setSpeechAvailable] = useState<boolean | null>(null);
  const [transcribing, setTranscribing] = useState<TranscribeProgress | null>(null);

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

  const beginRecording = async () => {
    localStorage.setItem(MIC_ONBOARD_KEY, "1");
    const mic = await requestMicrophone();
    if (!mic.ok) {
      setError(mic.error);
      setMemo({ step: "idle" });
      return;
    }
    streamRef.current = mic.stream;
    setMicStream(mic.stream);
    const mimeType = pickSupportedAudioMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = createAudioRecorder(mic.stream, mimeType);
    } catch {
      mic.stream.getTracks().forEach((t) => t.stop());
      setError("Format d'enregistrement non pris en charge par ce navigateur.");
      setMemo({ step: "idle" });
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      mic.stream.getTracks().forEach((t) => t.stop());
      if (chunksRef.current.length === 0) {
        setMemo({ step: "idle" });
        setError("Aucun son capté — réessaie l'enregistrement.");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      setMemo({ step: "preview", blob, durationSec });
    };
    mic.stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          try { recorderRef.current.stop(); } catch { /* déjà arrêté */ }
        }
      };
    });
    recorder.onerror = () => {
      transcriberRef.current?.stop();
      transcriberRef.current = null;
      mic.stream.getTracks().forEach((t) => t.stop());
      setError("Erreur d'enregistrement — réessaie.");
      setMemo({ step: "idle" });
    };

    setTranscript("");
    startedAtRef.current = Date.now();
    setElapsed(0);
    recorder.start();
    setMemo({ step: "recording", startedAt: startedAtRef.current });
    setSpeechAvailable(null);
    window.setTimeout(() => {
      if (recorderRef.current === recorder && recorder.state === "recording") {
        transcriberRef.current = startLiveTranscription(setTranscript);
        setSpeechAvailable(transcriberRef.current !== null);
      }
    }, 200);
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
    setError(null);
    onClose();
  };

  const transcribeMemo = async () => {
    if (memo.step !== "preview" || transcribing) return;
    setError(null);
    setTranscribing({ phase: "decoding" });
    try {
      const text = await transcribeBlobLocally(memo.blob, setTranscribing);
      if (text) setTranscript(text);
      else setError("Rien à transcrire (silence ou parole non détectée).");
    } catch (err) {
      const detail = err instanceof Error ? ` (${err.message.slice(0, 120)})` : "";
      setError(`Transcription impossible${detail} — le mémo reste enregistrable tel quel.`);
    } finally {
      setTranscribing(null);
    }
  };

  const saveMemo = async () => {
    if (memo.step !== "preview") return;
    const { blob, durationSec } = memo;
    const ext = blob.type.split(";")[0].split("/")[1] || "webm";
    const filename = `memo-${Date.now()}.${ext}`;
    const cleanTranscript = transcript.trim() || undefined;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueueCapture({ kind: "memo", visitId, blob, filename, durationSec, transcript: cleanTranscript });
      setMemo({ step: "idle" });
      setTranscript("");
      onInfo?.("Mémo en attente de connexion — envoi automatique au retour du réseau.");
      onClose();
      return;
    }

    setMemo({ step: "saving" });
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", blob, filename);
      fd.append("durationSec", String(durationSec));
      if (cleanTranscript) fd.append("transcript", cleanTranscript);
      const res = await fetch(`/api/visits/${visitId}/audio`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'envoi du mémo");
        setMemo({ step: "preview", blob, durationSec });
        return;
      }
      setMemo({ step: "idle" });
      setTranscript("");
      onCreated({ id: data.id, storageKey: data.storageKey, durationSec: data.durationSec, transcript: data.transcript ?? null });
      onClose();
    } catch {
      await enqueueCapture({ kind: "memo", visitId, blob, filename, durationSec, transcript: cleanTranscript });
      setMemo({ step: "idle" });
      setTranscript("");
      onInfo?.("Réseau indisponible — mémo mis en file, envoi automatique dès que possible.");
      onClose();
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const previewBlob = memo.step === "preview" ? memo.blob : null;
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
            onClick={memo.step === "recording" || memo.step === "saving" ? undefined : cancelMemo}
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
                    onClick={beginRecording}
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
                    onClick={beginRecording}
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
                      {speechAvailable === false
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
                {previewUrl && <audio controls src={previewUrl} className="w-full h-9" />}
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={3}
                  placeholder="Transcription (modifiable, ou vide)…"
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)] resize-y placeholder:text-[var(--text-tertiary)]"
                />
                {!transcript.trim() && memo.step === "preview" && (
                  <button
                    onClick={transcribeMemo}
                    disabled={transcribing !== null}
                    className="w-full py-2 rounded-lg text-xs text-[var(--text-secondary)] border border-dashed border-[var(--border-default)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors disabled:opacity-60"
                  >
                    {transcribing === null
                      ? "✎ Transcrire ce mémo (local, ~40 Mo au 1er usage)"
                      : transcribing.phase === "downloading"
                        ? `Téléchargement du modèle… ${transcribing.loadedMB ?? 0}/${transcribing.totalMB ?? "?"} Mo`
                        : transcribing.phase === "transcribing"
                          ? "Transcription en cours…"
                          : "Préparation de l'audio…"}
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
                    {memo.step === "saving" ? "Envoi…" : "Ajouter au carnet"}
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
