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
  duration: number; // seconds
  thumbnailUrl: string | null;
  storyboardSpec: string | null;
}

interface CapturedFrame {
  dataUrl: string;
  timestamp: number;
}

type Mode = "stills" | "mosaic";
type Step = "input" | "ready" | "capturing" | "preview" | "importing" | "done";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function getTimestamps(duration: number, count: number): number[] {
  const start = Math.round(duration * 0.05);
  const end = Math.round(duration * 0.92);
  if (count === 1) return [Math.round(duration / 2)];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(start + i * step));
}

/** Convert a base64 data URL to a File for upload. */
function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new File([bytes], filename, { type: mimeType });
}

/** Compose N frames into a 3×3 mosaic with timestamp badges. */
async function composeMosaic(frames: CapturedFrame[]): Promise<File> {
  const images = await Promise.all(
    frames.map(
      (f) =>
        new Promise<HTMLImageElement>((resolve) => {
          const img = new window.Image();
          img.onload = () => resolve(img);
          img.src = f.dataUrl;
        })
    )
  );

  const fw = images[0].naturalWidth;
  const fh = images[0].naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = fw * 3;
  canvas.height = fh * 3;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const labelH = Math.max(14, Math.round(fh * 0.1));
  const fontSize = Math.max(9, Math.round(labelH * 0.65));

  images.forEach((img, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    ctx.drawImage(img, col * fw, row * fh, fw, fh);

    const ts = formatDuration(frames[i].timestamp);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(col * fw, (row + 1) * fh - labelH, fw, labelH);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `${fontSize}px monospace`;
    ctx.fillText(ts, col * fw + 4, (row + 1) * fh - 4);
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], "mosaic.jpg", { type: "image/jpeg" }))
          : reject(new Error("Mosaic toBlob failed")),
      "image/jpeg",
      0.92
    );
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function YouTubeImportClient() {
  const [url, setUrl] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [mode, setMode] = useState<Mode>("stills");
  const [step, setStep] = useState<Step>("input");
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [frameResolution, setFrameResolution] = useState<{ width: number; height: number } | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const frameCount = mode === "stills" ? 5 : 9;

  // ── Load video info via oEmbed + page parse (no auth required) ────────────

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

  // ── Fetch storyboard frames from the server ───────────────────────────────

  const captureFrames = async () => {
    if (!info?.storyboardSpec) return;
    setStep("capturing");
    setFrames([]);
    setFrameResolution(null);

    const timestamps = getTimestamps(info.duration, frameCount);

    try {
      const res = await fetch("/api/youtube/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyboardSpec: info.storyboardSpec,
          duration: info.duration,
          timestamps,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.frames?.length) {
        setError(data.error ?? "Impossible d'extraire les frames");
        setStep("ready");
        return;
      }

      setFrames(data.frames as CapturedFrame[]);
      setFrameResolution(data.resolution ?? null);
      setStep("preview");
    } catch {
      setError("Erreur réseau lors de l'extraction");
      setStep("ready");
    }
  };

  // ── Upload frames + auto-create collection ────────────────────────────────

  const importFrames = async () => {
    if (!info || !frames.length) return;
    setStep("importing");
    setImportProgress(0);

    const inspirationIds: string[] = [];

    const uploadFile = async (file: File): Promise<string | null> => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: formData });
      const data = await res.json();
      return data.inspirationId ?? null;
    };

    if (mode === "mosaic") {
      const mosaicFile = await composeMosaic(frames);
      const id = await uploadFile(mosaicFile);
      if (id) {
        await fetch(`/api/inspirations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: info.title,
            sourceUrl: `https://youtube.com/watch?v=${info.videoId}`,
            notes: `Mosaïque 3×3 · ${info.author}\nTimestamps : ${frames
              .map((f) => formatDuration(f.timestamp))
              .join(" · ")}`,
          }),
        });
        inspirationIds.push(id);
      }
      setImportProgress(1);
    } else {
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const ts = formatDuration(frame.timestamp).replace(":", "m") + "s";
        const file = dataUrlToFile(frame.dataUrl, `still-${ts}.jpg`);
        const id = await uploadFile(file);
        if (id) {
          await fetch(`/api/inspirations/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: `${info.title} — ${formatDuration(frame.timestamp)}`,
              sourceUrl: `https://youtube.com/watch?v=${info.videoId}&t=${frame.timestamp}s`,
            }),
          });
          inspirationIds.push(id);
        }
        setImportProgress(i + 1);
      }
    }

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
  };

  const reset = () => {
    setFrames([]);
    setInfo(null);
    setStep("input");
    setUrl("");
    setCollectionId(null);
    setError(null);
    setImportProgress(0);
    setFrameResolution(null);
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
                  onKeyDown={(e) => e.key === "Enter" && !loadingInfo && loadInfo()}
                />
                <button
                  onClick={loadInfo}
                  disabled={loadingInfo || !url.trim()}
                  className="px-4 py-2 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2 flex-shrink-0"
                >
                  {loadingInfo && (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-base)]/60 border-t-transparent animate-spin" />
                  )}
                  {loadingInfo ? "Chargement…" : "Charger"}
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Gratuit · Sans clé API · Fonctionne pour toutes les vidéos publiques.
            </p>
          </motion.div>
        )}

        {/* ── Step 2: Video info + mode selection ── */}
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
              {info.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={info.thumbnailUrl}
                  alt=""
                  className="w-32 rounded-md object-cover flex-shrink-0 self-start"
                  style={{ aspectRatio: "16/9" }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] leading-snug line-clamp-2">
                  {info.title}
                </p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">{info.author}</p>
                <p className="text-xs text-[var(--text-tertiary)]">{formatDuration(info.duration)}</p>
                {!info.storyboardSpec && (
                  <p className="text-[10px] text-yellow-500 mt-1.5">
                    ⚠ Storyboard non disponible pour cette vidéo (trop courte ou restriction).
                  </p>
                )}
              </div>
              <button
                onClick={reset}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] self-start flex-shrink-0 text-xs transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Mode selector */}
            {info.storyboardSpec && (
              <>
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
                          {m === "stills" ? "□ □ □ □ □" : "⊞"}
                        </div>
                        <p className="text-xs font-medium text-[var(--text-primary)]">
                          {m === "stills" ? "5 images séparées" : "Mosaïque 3×3"}
                        </p>
                        <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-relaxed">
                          {m === "stills"
                            ? "5 stills dans la bibliothèque, liés au timestamp YouTube"
                            : "1 image composite — vue d'ensemble avec horodatages"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {error && <p className="text-xs text-red-400">{error}</p>}

                <button
                  onClick={captureFrames}
                  className="w-full py-2.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Extraire {frameCount} frames →
                </button>
              </>
            )}
          </motion.div>
        )}

        {/* ── Step 3: Extracting ── */}
        {step === "capturing" && (
          <motion.div
            key="capturing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-20 flex flex-col items-center gap-4 text-center"
          >
            <span className="w-6 h-6 rounded-full border-2 border-[var(--text-primary)] border-t-transparent animate-spin" />
            <p className="text-sm text-[var(--text-primary)]">Extraction des frames…</p>
            <p className="text-xs text-[var(--text-tertiary)]">
              Téléchargement des sprites YouTube en cours
            </p>
          </motion.div>
        )}

        {/* ── Step 4: Preview + confirm ── */}
        {step === "preview" && frames.length > 0 && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-5"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {frames.length} frame{frames.length > 1 ? "s" : ""} extraite{frames.length > 1 ? "s" : ""}
                </p>
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  {mode === "mosaic"
                    ? "Assemblées en une mosaïque 3×3 à l'import."
                    : "Importées séparément, liées à leur timestamp."}
                </p>
              </div>
              {/* Resolution badge */}
              {frameResolution && (
                <span className="text-[9px] px-2 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-tertiary)] flex-shrink-0">
                  {frameResolution.width}×{frameResolution.height} px
                </span>
              )}
            </div>

            <div
              className={cn(
                "grid gap-1.5",
                mode === "mosaic" ? "grid-cols-3" : "grid-cols-5"
              )}
            >
              {frames.map((f, i) => (
                <div
                  key={i}
                  className="relative rounded-md overflow-hidden bg-[var(--bg-surface)]"
                  style={{ aspectRatio: "16/9" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.dataUrl} alt="" className="w-full h-full object-cover" />
                  <div className="absolute bottom-1 left-1 text-[8px] bg-black/55 text-white/90 px-1 py-0.5 rounded font-mono">
                    {formatDuration(f.timestamp)}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={captureFrames}
                className="px-4 py-2 text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-md hover:border-[var(--border-default)] hover:text-[var(--text-primary)] transition-colors"
              >
                ↺ Ré-extraire
              </button>
              <button
                onClick={importFrames}
                className="px-5 py-2 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Importer {mode === "mosaic" ? "la mosaïque" : `${frames.length} images`} →
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Step 5: Importing ── */}
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
                  : `Import ${importProgress}/${frames.length}…`}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">Création de la collection…</p>
            </div>
          </motion.div>
        )}

        {/* ── Step 6: Done ── */}
        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-20 flex flex-col items-center gap-5 text-center"
          >
            <div className="text-3xl opacity-20">✓</div>
            <div>
              <p className="text-lg font-light text-[var(--text-primary)]">Import terminé</p>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">
                {mode === "mosaic" ? "Mosaïque créée" : `${frames.length} images importées`}
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
