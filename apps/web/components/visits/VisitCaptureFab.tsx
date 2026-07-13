"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  pickSupportedAudioMimeType,
  requestMicrophone,
  startLiveTranscription,
  type LiveTranscriber,
} from "@/lib/audio/recorder";
import { compressImageForUpload } from "@/lib/image/clientResize";

const LONG_PRESS_MS = 450;
const MIC_ONBOARD_KEY = "mb-mic-onboarded";

type MemoPhase =
  | { step: "idle" }
  | { step: "onboarding" }
  | { step: "recording"; startedAt: number }
  | { step: "preview"; blob: Blob; durationSec: number }
  | { step: "saving" };

// FAB de capture "friction zéro" (Phase 1 mobile du plan Assistant de Visite) :
// - **Tap** → appareil photo natif (`capture="environment"`) → upload →
//   rattachement direct à la visite, zéro formulaire.
// - **Appui long** → mémo vocal : enregistrement micro + transcription EN
//   DIRECT via la Web Speech API (localement dans le navigateur — décision
//   produit : pas d'API IA externe). Au relâchement : aperçu + transcript
//   éditable, puis le mémo devient une note du carnet (bloc audio + texte).
// - Permission micro demandée au PREMIER usage seulement, précédée d'une
//   modale explicative (onboarding contextuel).
export function VisitCaptureFab({ visitId }: { visitId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [memo, setMemo] = useState<MemoPhase>({ step: "idle" });
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // null = pas encore déterminé (reconnaissance lancée avec un léger délai)
  const [speechAvailable, setSpeechAvailable] = useState<boolean | null>(null);

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

  // ── Photo (tap) ──
  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("Hors ligne — connexion requise pour envoyer la photo.");
      return;
    }
    setUploadingPhoto(true);
    setError(null);
    try {
      const ids: string[] = [];
      for (const file of Array.from(files)) {
        // Une photo caméra brute dépasse souvent la limite serveur (10 Mo) —
        // compression/ré-encodage local avant envoi (voir clientResize.ts).
        const uploadFile = await compressImageForUpload(file);
        const fd = new FormData();
        fd.append("file", uploadFile);
        const res = await fetch("/api/upload/image", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        // ⚠ l'API renvoie `inspirationId`, pas `id` — lire le mauvais champ
        // affichait "Échec de l'upload" alors que l'image était bien créée
        // (retrouvée en triage), et le rattachement ne partait jamais.
        if (res.ok && data.inspirationId) ids.push(data.inspirationId);
        else setError(data.error ?? "Échec de l'upload");
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
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  const saveMemo = async () => {
    if (memo.step !== "preview") return;
    const { blob, durationSec } = memo;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("Hors ligne — connexion requise pour envoyer le mémo. Le clip reste dans l'aperçu.");
      return;
    }
    setMemo({ step: "saving" });
    setError(null);
    try {
      const ext = blob.type.split(";")[0].split("/")[1] || "webm";
      const fd = new FormData();
      fd.append("file", blob, `memo.${ext}`);
      fd.append("durationSec", String(durationSec));
      const res = await fetch(`/api/visits/${visitId}/audio`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'envoi du mémo");
        setMemo({ step: "preview", blob, durationSec });
        return;
      }
      // Le mémo devient une note du carnet : bloc audio + transcript en
      // paragraphe (même sérialisation que le node Tiptap AudioBlock).
      const esc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const html =
        `<div data-type="audio-block" audioid="${esc(data.id)}" storagekey="${esc(data.storageKey)}" durationsec="${data.durationSec ?? durationSec}"></div>` +
        (transcript.trim() ? `<p>${esc(transcript.trim())}</p>` : "");
      const noteRes = await fetch(`/api/visits/${visitId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: html }),
      });
      if (!noteRes.ok) {
        setError("Mémo envoyé mais la note n'a pas pu être créée.");
        setMemo({ step: "preview", blob, durationSec });
        return;
      }
      setMemo({ step: "idle" });
      setTranscript("");
      router.refresh();
    } catch {
      setError("Échec de l'envoi du mémo");
      // Ne pas jeter l'enregistrement : retour à l'aperçu pour réessayer.
      setMemo({ step: "preview", blob, durationSec });
    }
  };

  // ── Gestion tap vs appui long sur le FAB ──
  const onFabPointerDown = () => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      navigator.vibrate?.(15);
      startMemo();
    }, LONG_PRESS_MS);
  };
  const onFabPointerUp = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    if (!longPressFired.current && memo.step === "idle" && !uploadingPhoto) {
      fileInputRef.current?.click();
    }
  };
  const onFabPointerLeave = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  };

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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => handlePhotoFiles(e.target.files)}
      />

      {/* FAB — au-dessus de la BottomNav mobile (h-14) + safe area */}
      <button
        type="button"
        onPointerDown={onFabPointerDown}
        onPointerUp={onFabPointerUp}
        onPointerLeave={onFabPointerLeave}
        // iOS peut interrompre la séquence pointer (gesture système) — sans
        // ça le timer d'appui long resterait armé et déclencherait un mémo
        // fantôme après coup.
        onPointerCancel={onFabPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
        title="Photo (appui long : mémo vocal)"
        className={cn(
          "fixed right-4 md:right-6 z-[65] w-14 h-14 rounded-full flex items-center justify-center",
          // Mobile : au-dessus de la BottomNav (h-14) + safe area ; desktop : coin bas-droit
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
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
      </button>

      {error && memo.step === "idle" && (
        <div className="fixed inset-x-4 z-[65] md:left-auto md:right-6 md:w-72" style={{ bottom: "calc(8.5rem + env(safe-area-inset-bottom))" }}>
          <div className="rounded-lg bg-[var(--bg-elevated)] border border-red-500/30 px-3 py-2 text-xs text-red-400 shadow-xl flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-[var(--text-tertiary)]">✕</button>
          </div>
        </div>
      )}

      {typeof document !== "undefined" && createPortal(overlay, document.body)}
    </>
  );
}
