"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { transcribeBlobLocally } from "@/lib/audio/transcribe";
import { enqueueCapture } from "@/lib/offline/outbox";

// Traitement de fond des mémos vocaux (2026-07-19). À la fin de l'enregistrement,
// le mémo est traité SANS bloquer l'utilisateur : upload → la tuile apparaît
// tout de suite (audio jouable), puis transcription + timings par mot dans un
// Web Worker (UI non figée, voir lib/audio/whisper.worker.ts), puis mise à jour
// de la tuile. L'utilisateur continue à manipuler le carnet pendant ce temps ;
// le FAB « + » affiche un spinner tant qu'au moins un mémo est en traitement.
interface BackgroundMemoCtx {
  /** Lance le pipeline de fond pour un clip fraîchement enregistré. */
  processMemo: (blob: Blob, durationSec: number) => void;
  /** Nombre de mémos en cours de traitement (0 = rien en fond). */
  activeCount: number;
  /** Dernier message d'erreur non bloquant (upload/transcription), ou null. */
  error: string | null;
  clearError: () => void;
}

const Ctx = createContext<BackgroundMemoCtx | null>(null);
export function useBackgroundMemo(): BackgroundMemoCtx | null {
  return useContext(Ctx);
}

export function BackgroundMemoProvider({ visitId, children }: { visitId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [activeCount, setActiveCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);
  // router.refresh() ré-rend toute la page ; on évite d'en déclencher trop
  // rapprochés quand plusieurs mémos finissent quasi ensemble.
  const refreshTimer = useRef<number | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => router.refresh(), 120);
  }, [router]);

  const processMemo = useCallback(
    (blob: Blob, durationSec: number) => {
      setActiveCount((c) => c + 1);
      const ext = blob.type.split(";")[0].split("/")[1] || "webm";
      const filename = `memo-${Date.now()}.${ext}`;

      (async () => {
        try {
          // Hors ligne : on transcrit quand même localement (modèle en cache) puis
          // on met en file — l'upload + le rattachement se feront au retour réseau.
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            let transcript: string | undefined;
            let words: { word: string; start: number; end: number }[] | undefined;
            try {
              const r = await transcribeBlobLocally(blob);
              transcript = r.text.trim() || undefined;
              words = r.words.length > 0 ? r.words : undefined;
            } catch { /* transcription best-effort */ }
            await enqueueCapture({ kind: "memo", visitId, blob, filename, durationSec, transcript, wordTimings: words });
            setError("Hors ligne — mémo en file, envoi automatique au retour du réseau.");
            return;
          }

          // 1) Upload de l'audio → la tuile apparaît (transcription à venir).
          const fd = new FormData();
          fd.append("file", blob, filename);
          fd.append("durationSec", String(durationSec));
          const res = await fetch(`/api/visits/${visitId}/audio`, { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.id) {
            // Échec réseau : mise en file pour rejeu (avec transcription locale).
            let transcript: string | undefined;
            let words: { word: string; start: number; end: number }[] | undefined;
            try {
              const r = await transcribeBlobLocally(blob);
              transcript = r.text.trim() || undefined;
              words = r.words.length > 0 ? r.words : undefined;
            } catch { /* best-effort */ }
            await enqueueCapture({ kind: "memo", visitId, blob, filename, durationSec, transcript, wordTimings: words });
            setError("Réseau instable — mémo en file, envoi automatique dès que possible.");
            return;
          }
          scheduleRefresh();

          // 2) Transcription + timings dans le worker (UI non bloquée).
          const { text, words } = await transcribeBlobLocally(blob);

          // 3) Rattache le résultat à la tuile déjà créée.
          if (text || words.length > 0) {
            await fetch(`/api/visits/${visitId}/audio/${data.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transcript: text || null, wordTimings: words }),
            }).catch(() => {});
            scheduleRefresh();
          }
        } catch {
          setError("Le traitement du mémo a échoué — l'audio reste enregistré, transcription à relancer.");
        } finally {
          setActiveCount((c) => Math.max(0, c - 1));
        }
      })();
    },
    [visitId, scheduleRefresh],
  );

  return <Ctx.Provider value={{ processMemo, activeCount, error, clearError }}>{children}</Ctx.Provider>;
}
