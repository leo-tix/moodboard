"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VideoInfo {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  frameUrls: string[];
  frameLabels: string[];
}

type Mode = "stills" | "mosaic";
type Step = "input" | "ready" | "importing" | "done";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a base64 data URL to a File for upload. */
function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new File([bytes], filename, { type: mimeType });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function YouTubeImportClient() {
  const [url, setUrl] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [mode, setMode] = useState<Mode>("stills");
  const [step, setStep] = useState<Step>("input");
  const [importProgress, setImportProgress] = useState(0);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Load video info via oEmbed (no auth required, always works) ───────────

  const loadInfo = async () => {
    if (!url.trim()) return;
    setLoadingInfo(true);
    setError(null);
    try {
      const res = await fetch("/api/youtube/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur lors du chargement");
        return;
      }
      setInfo(data as VideoInfo);
      setStep("ready");
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoadingInfo(false);
    }
  };

  // ── Fetch frames from server + upload ─────────────────────────────────────

  const importFrames = async () => {
    if (!info) return;
    setStep("importing");
    setImportProgress(0);
    setError(null);

    try {
      // Server fetches + resizes the YouTube thumbnails, optionally composes mosaic
      const framesRes = await fetch("/api/youtube/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frameUrls: info.frameUrls,
          frameLabels: info.frameLabels,
          mode,
        }),
      });
      const framesData = await framesRes.json();
      if (!framesRes.ok) {
        setError(framesData.error ?? "Impossible de charger les images");
        setStep("ready");
        return;
      }

      const uploadFile = async (file: File): Promise<string | null> => {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload/image", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        return data.inspirationId ?? null;
      };

      const inspirationIds: string[] = [];

      if (mode === "mosaic") {
        const file = dataUrlToFile(framesData.dataUrl, "mosaic.jpg");
        const id = await uploadFile(file);
        if (id) {
          await fetch(`/api/inspirations/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: info.title,
              sourceUrl: `https://youtube.com/watch?v=${info.videoId}`,
              notes: `Mosaïque 2×2 · ${info.author}`,
            }),
          });
          inspirationIds.push(id);
        }
        setImportProgress(1);
      } else {
        const frames = framesData.frames as { dataUrl: string; label: string }[];
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          const file = dataUrlToFile(
            frame.dataUrl,
            `still-${frame.label.replace(/[^a-z0-9]/gi, "_")}.jpg`
          );
          const id = await uploadFile(file);
          if (id) {
            await fetch(`/api/inspirations/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: `${info.title} — ${frame.label}`,
                sourceUrl: `https://youtube.com/watch?v=${info.videoId}`,
              }),
            });
            inspirationIds.push(id);
          }
          setImportProgress(i + 1);
        }
      }

      // Auto-create a collection
      if (inspirationIds.length > 0) {
        const colRes = await fetch("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: info.title,
            description: `${info.author} · Import YouTube`,
          }),
        });
        const col = await colRes.json();
        await fetch(`/api/collections/${col.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inspirationIds }),
        });
        setCollectionId(col.id);
      }

      setStep("done");
    } catch {
      setError("Erreur réseau lors de l'import");
      setStep("ready");
    }
  };

  const reset = () => {
    setInfo(null);
    setStep("input");
    setUrl("");
    setCollectionId(null);
    setError(null);
    setImportProgress(0);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      <AnimatePresence mode="wait">

        {/* ── Step 1: URL input ── */}
        {step === "input" && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-4"
          >
            <div>
              <label className="block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                URL YouTube
              </label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] rounded-md px-3 py-2 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]"
                  placeholder="https://youtube.com/watch?v=… ou youtu.be/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && !loadingInfo && loadInfo()
                  }
                />
                <button
                  onClick={loadInfo}
                  disabled={loadingInfo || !url.trim()}
                  className="px-4 py-2 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2 flex-shrink-0"
                >
                  {loadingInfo && (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-base)]/60 border-t-transparent animate-spin" />
                  )}
                  {loadingInfo ? "Chargement…" : "Analyser"}
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Importe les 4 captures auto-générées par YouTube (thumbnail + 25 / 50 / 75%).
            </p>
          </motion.div>
        )}

        {/* ── Step 2: Video info + frame preview + mode selection ── */}
        {step === "ready" && info && (
          <motion.div
            key="ready"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-6"
          >
            {/* Video card */}
            <div className="flex gap-4 p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={info.thumbnailUrl}
                alt=""
                className="w-28 rounded-md object-cover flex-shrink-0 self-start"
                style={{ aspectRatio: "16/9" }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] leading-snug line-clamp-2">
                  {info.title}
                </p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {info.author}
                </p>
              </div>
              <button
                onClick={reset}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] self-start flex-shrink-0 text-xs transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Frame preview grid */}
            <div>
              <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-2">
                Aperçu des 4 captures
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {info.frameUrls.map((src, i) => (
                  <div
                    key={i}
                    className="relative rounded-md overflow-hidden bg-[var(--bg-surface)]"
                    style={{ aspectRatio: "16/9" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={info.frameLabels[i]}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-1 left-1 text-[7px] bg-black/60 text-white/90 px-1 py-0.5 rounded font-mono">
                      {info.frameLabels[i]}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mode selector */}
            <div>
              <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-3">
                Mode d&apos;import
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(["stills", "mosaic"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "p-4 rounded-xl border text-left transition-colors",
                      mode === m
                        ? "border-[var(--text-primary)] bg-[var(--bg-elevated)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]"
                    )}
                  >
                    <div className="text-base mb-2 opacity-40 font-mono tracking-widest">
                      {m === "stills" ? "□ □ □ □" : "⊞"}
                    </div>
                    <p className="text-xs font-medium text-[var(--text-primary)]">
                      {m === "stills" ? "4 images séparées" : "Mosaïque 2×2"}
                    </p>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-relaxed">
                      {m === "stills"
                        ? "4 stills dans la bibliothèque (thumbnail + 3 captures)"
                        : "1 image composite 960×540 — vue d'ensemble"}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={importFrames}
              className="w-full py-2.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Importer {mode === "mosaic" ? "la mosaïque 2×2" : "les 4 images"} →
            </button>
          </motion.div>
        )}

        {/* ── Step 3: Importing ── */}
        {step === "importing" && (
          <motion.div
            key="importing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-20 flex flex-col items-center gap-4 text-center"
          >
            <span className="w-8 h-8 rounded-full border-2 border-[var(--text-primary)] border-t-transparent animate-spin" />
            <div>
              <p className="text-sm text-[var(--text-primary)]">
                {mode === "mosaic"
                  ? "Composition de la mosaïque…"
                  : `Import ${importProgress} / 4…`}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Création de la collection…
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Step 4: Done ── */}
        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-20 flex flex-col items-center gap-5 text-center"
          >
            <div className="text-3xl opacity-20">✓</div>
            <div>
              <p className="text-lg font-light text-[var(--text-primary)]">
                Import terminé
              </p>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">
                {mode === "mosaic" ? "Mosaïque 2×2 créée" : "4 images importées"}
                {" · "}Collection créée
              </p>
            </div>
            <div className="flex gap-3">
              {collectionId && (
                <Link
                  href={`/collections/${collectionId}`}
                  className="px-5 py-2 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Voir la collection →
                </Link>
              )}
              <button
                onClick={reset}
                className="px-4 py-2 border border-[var(--border-default)] text-[var(--text-secondary)] rounded-md text-sm hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
              >
                Nouvel import
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
