"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Mic, Camera, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  pickSupportedAudioMimeType,
  requestMicrophone,
  startLiveTranscription,
  type LiveTranscriber,
} from "@/lib/audio/recorder";
import { compressImageForUpload } from "@/lib/image/clientResize";
import { transcribeBlobLocally, type TranscribeProgress } from "@/lib/audio/transcribe";
import { enqueueCapture, OUTBOX_SYNCED_EVENT } from "@/lib/offline/outbox";
import { VoiceWaveform } from "@/components/visits/VoiceWaveform";

const LONG_PRESS_MS = 450;
const MIC_ONBOARD_KEY = "mb-mic-onboarded";

type MemoPhase =
  | { step: "idle" }
  | { step: "onboarding" }
  | { step: "recording"; startedAt: number }
  | { step: "preview"; blob: Blob; durationSec: number }
  | { step: "saving" };

// FAB de capture "friction zéro" (Phase 1 mobile du plan Assistant de Visite) :
// - **Tap** → ouvre un petit menu à 3 choix (galerie / micro / appareil
//   photo) — zoning UI du 2026-07-13, remplace l'ancien tap = appareil
//   photo direct.
// - **Appui long** → INCHANGÉ, raccourci direct vers le mémo vocal (ne passe
//   pas par le menu) : enregistrement micro + transcription EN DIRECT via
//   la Web Speech API (localement dans le navigateur — décision produit :
//   pas d'API IA externe). Au relâchement : aperçu + transcript éditable,
//   puis le mémo devient un bloc Audio autonome du carnet.
// - Permission micro demandée au PREMIER usage seulement, précédée d'une
//   modale explicative (onboarding contextuel).
export function VisitCaptureFab({ visitId }: { visitId: string }) {
  const router = useRouter();
  // Deux inputs distincts : la galerie (pas de `capture`, l'utilisateur
  // choisit des photos existantes) et l'appareil photo (`capture="environment"`,
  // force la prise de vue) — même pipeline d'upload derrière les deux.
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const fabButtonRef = useRef<HTMLButtonElement>(null);
  const [memo, setMemo] = useState<MemoPhase>({ step: "idle" });
  // Flux micro exposé à la waveform réactive pendant l'enregistrement.
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Message neutre (capture mise en file hors ligne) — distinct de `error`.
  const [info, setInfo] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // null = pas encore déterminé (reconnaissance lancée avec un léger délai)
  const [speechAvailable, setSpeechAvailable] = useState<boolean | null>(null);
  // Progression de la transcription locale post-enregistrement (Whisper WASM)
  const [transcribing, setTranscribing] = useState<TranscribeProgress | null>(null);

  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriberRef = useRef<LiveTranscriber | null>(null);
  const startedAtRef = useRef(0);

  // Chrono d'enregistrement
  useEffect(() => {
    if (memo.step !== "recording") return;
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [memo.step]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  }, []);

  // Ferme le menu d'actions au clic/tap en dehors (le bouton FAB lui-même
  // gère son propre toggle via onFabPointerUp, exclu ici pour ne pas
  // rouvrir immédiatement ce qu'il vient de fermer).
  useEffect(() => {
    if (!actionMenuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const insideMenu = actionMenuRef.current?.contains(target);
      const onFabButton = fabButtonRef.current?.contains(target);
      if (!insideMenu && !onFabButton) setActionMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [actionMenuOpen]);

  // Si l'appli passe en arrière-plan pendant un enregistrement (verrouillage
  // écran, changement d'appli — courant en visite), arrêter et conserver ce
  // qui a été capté plutôt que de laisser un enregistrement fantôme que le
  // navigateur suspend silencieusement.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && memo.step === "recording") stopMemo();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo.step]);

  // Une capture rejouée depuis la file hors ligne vient d'atterrir côté serveur
  // → rafraîchir le carnet pour la faire apparaître (offline-first Phase 4).
  useEffect(() => {
    const onSynced = (e: Event) => {
      const detail = (e as CustomEvent<{ visitId: string }>).detail;
      if (!detail || detail.visitId === visitId) router.refresh();
    };
    window.addEventListener(OUTBOX_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OUTBOX_SYNCED_EVENT, onSynced);
  }, [visitId, router]);

  // Auto-effacement du message neutre "en attente de connexion".
  useEffect(() => {
    if (!info) return;
    const t = window.setTimeout(() => setInfo(null), 4000);
    return () => window.clearTimeout(t);
  }, [info]);

  // ── Photo (tap) ──
  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setError(null);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    try {
      // Une photo caméra brute dépasse souvent la limite serveur (10 Mo) —
      // compression/ré-encodage local AVANT tout (aussi bien pour l'envoi direct
      // que pour la mise en file, où l'on stocke déjà le blob compressé).
      const compressed = await Promise.all(Array.from(files).map((f) => compressImageForUpload(f)));

      // Hors ligne : mettre en file, ne rien perdre. Le rejeu se fera au retour
      // du réseau (voir lib/offline/outbox.ts).
      if (offline) {
        for (const [i, blob] of compressed.entries()) {
          await enqueueCapture({
            kind: "photo",
            visitId,
            blob,
            filename: `photo-${Date.now()}-${i}.jpg`,
          });
        }
        setInfo(
          `${compressed.length} photo${compressed.length > 1 ? "s" : ""} en attente de connexion — envoi automatique au retour du réseau.`,
        );
        return;
      }

      const ids: string[] = [];
      for (const [i, uploadFile] of compressed.entries()) {
        try {
          const fd = new FormData();
          fd.append("file", uploadFile);
          const res = await fetch("/api/upload/image", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          // ⚠ l'API renvoie `inspirationId`, pas `id` — lire le mauvais champ
          // affichait "Échec de l'upload" alors que l'image était bien créée
          // (retrouvée en triage), et le rattachement ne partait jamais.
          if (res.ok && data.inspirationId) ids.push(data.inspirationId);
          else throw new Error(data.error ?? "upload");
        } catch {
          // Échec réseau en cours d'upload (pas un vrai hors-ligne franc, mais
          // un blip) : plutôt que d'abandonner, mettre en file pour rejeu.
          await enqueueCapture({
            kind: "photo",
            visitId,
            blob: uploadFile,
            filename: `photo-${Date.now()}-${i}.jpg`,
          });
          setInfo("Réseau instable — photo mise en file, envoi automatique dès que possible.");
        }
      }
      if (ids.length > 0) {
        // L'image est déjà créée (visible en triage) à ce stade — sans
        // vérifier cette réponse, un échec réseau (fréquent en wifi musée)
        // laissait l'image orpheline : uploadée mais jamais rattachée à la
        // visite, invisible dans le carnet, seulement retrouvable en triage.
        // Un essai de secours avant d'abandonner (le premier échec est
        // souvent un simple blip réseau).
        const attach = () =>
          fetch(`/api/visits/${visitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addInspirationIds: ids }),
          });
        let res = await attach();
        if (!res.ok) res = await attach();
        if (!res.ok) {
          setError(
            `${ids.length > 1 ? "Photos envoyées" : "Photo envoyée"} mais pas rattachée à la visite (réseau instable ?) — elle${ids.length > 1 ? "s restent" : " reste"} disponible${ids.length > 1 ? "s" : ""} en triage.`
          );
        } else {
          router.refresh();
        }
      }
    } finally {
      setUploadingPhoto(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  // ── Mémo vocal (appui long) ──
  const startMemo = async () => {
    setError(null);
    // Onboarding contextuel : la toute première fois, expliquer AVANT que le
    // navigateur affiche sa demande de permission.
    if (!localStorage.getItem(MIC_ONBOARD_KEY)) {
      setMemo({ step: "onboarding" });
      return;
    }
    await beginRecording();
  };

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
      recorder = mimeType ? new MediaRecorder(mic.stream, { mimeType }) : new MediaRecorder(mic.stream);
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
      // Rien capté (arrêt quasi-immédiat, micro coupé avant la première
      // frame) : pas de blob vide silencieux, on repart proprement.
      if (chunksRef.current.length === 0) {
        setMemo({ step: "idle" });
        setError("Aucun son capté — réessaie l'enregistrement.");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      setMemo({ step: "preview", blob, durationSec });
    };
    // Sur certains mobiles, l'OS peut réattribuer le micro en cours de route
    // (appel entrant, autre appli, ou conflit avec la reconnaissance vocale
    // ci-dessous) — sans ce filet, l'enregistrement reste bloqué en
    // "recording" indéfiniment côté UI puisque `onstop` ne se déclenche
    // jamais tout seul. On force l'arrêt propre dès que la piste meurt.
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
    // Reconnaissance vocale en direct, partout où le navigateur la fournit
    // (décision produit : la transcription locale est conservée, y compris
    // mobile). Démarrée APRÈS l'enregistrement (léger décalage) pour limiter
    // la contention d'acquisition micro entre MediaRecorder et
    // SpeechRecognition ; si l'OS coupe quand même la piste, les filets
    // (track.onended / onerror / chunks vides) préviennent au lieu de
    // laisser l'UI pendue. Sur iOS PWA la Web Speech API est généralement
    // indisponible → indicateur honnête dans la feuille plutôt qu'un
    // placeholder qui attend pour rien.
    setSpeechAvailable(null);
    window.setTimeout(() => {
      if (recorderRef.current === recorder && recorder.state === "recording") {
        transcriberRef.current = startLiveTranscription(setTranscript);
        setSpeechAvailable(transcriberRef.current !== null);
      }
    }, 200);
  };

  const stopMemo = () => {
    const finalText = transcriberRef.current?.stop() ?? "";
    if (finalText) setTranscript(finalText);
    transcriberRef.current = null;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      // `onstop` a déjà tranché (piste coupée plus tôt, ou jamais démarré) —
      // rien à faire de plus ; si l'UI était restée bloquée en "recording"
      // sans qu'aucune donnée n'ait été produite, le signaler plutôt que de
      // laisser la feuille ouverte sans réaction au tap sur "Terminer".
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
      // Message technique inclus : indispensable pour diagnostiquer sur le
      // terrain (les échecs varient selon plateforme/réseau).
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

    // Hors ligne : mettre le mémo en file (avec sa transcription éditée) au lieu
    // de bloquer l'utilisateur — rejeu automatique au retour du réseau.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueueCapture({ kind: "memo", visitId, blob, filename, durationSec, transcript: cleanTranscript });
      setMemo({ step: "idle" });
      setTranscript("");
      setInfo("Mémo en attente de connexion — envoi automatique au retour du réseau.");
      return;
    }

    setMemo({ step: "saving" });
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", blob, filename);
      fd.append("durationSec", String(durationSec));
      if (cleanTranscript) fd.append("transcript", cleanTranscript);
      // Le mémo devient directement un bloc Audio autonome du carnet (refonte
      // "blocs purs" 2026-07-13) — plus de note wrapper, la transcription est
      // un champ natif de VisitAudio.
      const res = await fetch(`/api/visits/${visitId}/audio`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'envoi du mémo");
        setMemo({ step: "preview", blob, durationSec });
        return;
      }
      setMemo({ step: "idle" });
      setTranscript("");
      router.refresh();
    } catch {
      // Échec réseau : ne pas jeter l'enregistrement — le mettre en file pour
      // rejeu automatique plutôt que de forcer l'utilisateur à réessayer.
      await enqueueCapture({ kind: "memo", visitId, blob, filename, durationSec, transcript: cleanTranscript });
      setMemo({ step: "idle" });
      setTranscript("");
      setInfo("Réseau indisponible — mémo mis en file, envoi automatique dès que possible.");
    }
  };

  // ── Gestion tap vs appui long sur le FAB ──
  // Tap → ouvre/ferme le petit menu (galerie/micro/appareil photo). Appui
  // long → INCHANGÉ, raccourci direct vers le mémo vocal, ne passe jamais
  // par le menu (démarre avant même que le tap n'ait eu la chance de
  // s'exécuter, via longPressFired).
  const onFabPointerDown = () => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      navigator.vibrate?.(15);
      setActionMenuOpen(false);
      startMemo();
    }, LONG_PRESS_MS);
  };
  const onFabPointerUp = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    if (!longPressFired.current && memo.step === "idle" && !uploadingPhoto) {
      setActionMenuOpen((v) => !v);
    }
  };
  const onFabPointerLeave = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  };

  // ── Actions du menu (galerie / micro / appareil photo) ──
  const openGallery = () => { setActionMenuOpen(false); galleryInputRef.current?.click(); };
  const openCamera = () => { setActionMenuOpen(false); cameraInputRef.current?.click(); };
  const openMicFromMenu = () => { setActionMenuOpen(false); startMemo(); };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const memoOpen = memo.step !== "idle";

  // URL blob de l'aperçu — mémoïsée (le textarea re-render à chaque frappe)
  // et révoquée au changement pour ne pas fuir.
  const previewBlob = memo.step === "preview" ? memo.blob : null;
  const previewUrl = useMemo(() => (previewBlob ? URL.createObjectURL(previewBlob) : null), [previewBlob]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const overlay = (
    <AnimatePresence>
      {memoOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[70]"
            onClick={memo.step === "recording" || memo.step === "saving" ? undefined : cancelMemo}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className="fixed inset-x-0 bottom-0 z-[71] bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl p-5 md:max-w-md md:mx-auto md:rounded-2xl md:bottom-6"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
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
                {/* Waveform réactive (Siri/Gemini) branchée sur le micro en direct */}
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
                {/* Transcription locale post-enregistrement (Whisper WASM) —
                    la solution quand la Web Speech API n'a rien donné (PWA
                    iOS notamment). Action explicite : le 1er usage télécharge
                    le modèle (~40 Mo), pas de surprise sur données mobiles. */}
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* Galerie : pas de `capture`, l'utilisateur choisit des photos déjà
          existantes sur son appareil. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handlePhotoFiles(e.target.files)}
      />
      {/* Appareil photo : `capture` force la prise de vue native. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => handlePhotoFiles(e.target.files)}
      />

      {/* Menu d'actions (galerie / micro / appareil photo) — ouvert par un
          simple tap sur le FAB, zoning UI du 2026-07-13. L'appui long reste
          un raccourci direct vers le mémo vocal, sans jamais passer par ce
          menu (voir onFabPointerDown). */}
      <AnimatePresence>
        {actionMenuOpen && (
          <motion.div
            ref={actionMenuRef}
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: "tween", duration: 0.15, ease: [0.2, 0, 0, 1] }}
            className="fixed left-1/2 -translate-x-1/2 z-[66] bottom-[calc(8.75rem+env(safe-area-inset-bottom))] md:bottom-[10.25rem] flex flex-col items-center gap-2.5"
          >
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={openGallery}
                title="Choisir dans la galerie"
                className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl text-[var(--text-primary)] active:scale-95 transition-transform"
              >
                <ImageIcon size={20} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={openMicFromMenu}
                title="Mémo vocal"
                className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl text-[var(--text-primary)] active:scale-95 transition-transform"
              >
                <Mic size={20} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={openCamera}
                title="Prendre une photo"
                className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl text-[var(--text-primary)] active:scale-95 transition-transform"
              >
                <Camera size={20} strokeWidth={1.75} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setActionMenuOpen(false)}
              title="Fermer"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl text-[var(--text-tertiary)] hover:text-[var(--text-primary)] active:scale-95 transition-transform"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB — au-dessus de la BottomNav mobile (h-14) + safe area */}
      <button
        ref={fabButtonRef}
        type="button"
        onPointerDown={onFabPointerDown}
        onPointerUp={onFabPointerUp}
        onPointerLeave={onFabPointerLeave}
        // iOS peut interrompre la séquence pointer (gesture système) — sans
        // ça le timer d'appui long resterait armé et déclencherait un mémo
        // fantôme après coup.
        onPointerCancel={onFabPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
        title="Ajouter (appui long : mémo vocal)"
        className={cn(
          "fixed left-1/2 -translate-x-1/2 z-[65] w-14 h-14 rounded-full flex items-center justify-center",
          // Mobile : au-dessus de la BottomNav (h-14) + safe area ; desktop : bas-centre
          "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6",
          "bg-[var(--text-primary)] text-[var(--bg-base)] shadow-2xl shadow-black/50",
          "active:scale-95 transition-transform select-none touch-none",
          uploadingPhoto && "opacity-70 pointer-events-none"
        )}
        style={{ WebkitTouchCallout: "none" }}
      >
        {uploadingPhoto ? (
          <span className="w-5 h-5 border-2 border-[var(--bg-base)] border-t-transparent rounded-full animate-spin" />
        ) : (
          <Plus size={24} strokeWidth={2} />
        )}
      </button>

      {error && memo.step === "idle" && (
        <div className="fixed inset-x-4 z-[65] md:left-auto md:right-6 md:w-72" style={{ bottom: "calc(11rem + env(safe-area-inset-bottom))" }}>
          <div className="rounded-lg bg-[var(--bg-elevated)] border border-red-500/30 px-3 py-2 text-xs text-red-400 shadow-xl flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-[var(--text-tertiary)]">✕</button>
          </div>
        </div>
      )}

      {info && memo.step === "idle" && (
        <div className="fixed inset-x-4 z-[65] md:left-auto md:right-6 md:w-72" style={{ bottom: "calc(11rem + env(safe-area-inset-bottom))" }}>
          <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-xl flex items-start gap-2">
            <span className="flex-1">{info}</span>
            <button onClick={() => setInfo(null)} className="text-[var(--text-tertiary)]">✕</button>
          </div>
        </div>
      )}

      {typeof document !== "undefined" && createPortal(overlay, document.body)}
    </>
  );
}
