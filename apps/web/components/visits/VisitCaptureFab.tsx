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

  // ── Photo (tap) ──
  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const ids: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload/image", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.id) ids.push(data.id);
        else setError(data.error ?? "Échec de l'upload");
      }
      if (ids.length > 0) {
        await fetch(`/api/visits/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addInspirationIds: ids }),
        });
        router.refresh();
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
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      mic.stream.getTracks().forEach((t) => t.stop());
      setMemo({ step: "preview", blob, durationSec });
    };

    setTranscript("");
    transcriberRef.current = startLiveTranscription(setTranscript);
    startedAtRef.current = Date.now();
    setElapsed(0);
    recorder.start();
    setMemo({ step: "recording", startedAt: startedAtRef.current });
  };

  const stopMemo = () => {
    const finalText = transcriberRef.current?.stop() ?? "";
    if (finalText) setTranscript(finalText);
    transcriberRef.current = null;
    recorderRef.current?.stop();
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
                  {transcript || <span className="text-[var(--text-tertiary)] italic">La transcription apparaît ici…</span>}
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
