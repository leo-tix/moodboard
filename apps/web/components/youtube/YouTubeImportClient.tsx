"use client";

import { useRef, useState } from "react";
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
  streamUrl: string;
}

interface CapturedFrame {
  blob: Blob;
  objectUrl: string;
  timestamp: number; // seconds
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

/** Distribute N timestamps between 5 % and 92 % of duration (avoid intro/outro). */
function getTimestamps(duration: number, count: number): number[] {
  const start = Math.round(duration * 0.05);
  const end = Math.round(duration * 0.92);
  if (count === 1) return [Math.round(duration / 2)];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(start + i * step));
}

/** Seek the video to `timestamp` and return a JPEG blob via Canvas. */
async function captureFrameAtTime(
  video: HTMLVideoElement,
  timestamp: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.85
      );
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = timestamp;
  });
}

/** Stitch 9 frames into a 3×3 grid with timestamp labels. */
async function composeMosaic(frames: CapturedFrame[]): Promise<Blob> {
  const images = await Promise.all(
    frames.map(
      (f) =>
        new Promise<HTMLImageElement>((resolve) => {
          const img = new window.Image();
          img.onload = () => resolve(img);
          img.src = f.objectUrl;
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

  const labelH = Math.max(16, Math.round(fh * 0.08));
  const fontSize = Math.max(10, Math.round(labelH * 0.65));

  images.forEach((img, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    ctx.drawImage(img, col * fw, row * fh, fw, fh);

    // Timestamp badge
    const ts = formatDuration(frames[i].timestamp);
    const labelY = (row + 1) * fh - labelH;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(col * fw, labelY, fw, labelH);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `${fontSize}px monospace`;
    ctx.fillText(ts, col * fw + 6, labelY + labelH - 4);
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Mosaic toBlob failed"))),
      "image/jpeg",
      0.92
    );
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function YouTubeImportClient() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [url, setUrl] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [mode, setMode] = useState<Mode>("stills");
  const [step, setStep] = useState<Step>("input");
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [importProgress, setImportProgress] = useState(0);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const frameCount = mode === "stills" ? 5 : 9;

  // ── Load video metadata ───────────────────────────────────────────────────

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

  // ── Capture frames via hidden <video> + Canvas ────────────────────────────

  const captureFrames = async () => {
    if (!info || !videoRef.current) return;
    setStep("capturing");
    setCaptureProgress(0);

    // Revoke previous object URLs
    frames.forEach((f) => URL.revokeObjectURL(f.objectUrl));
    setFrames([]);

    const video = videoRef.current;
    const timestamps = getTimestamps(info.duration, frameCount);

    // Wait for video metadata to be available (needed for seeking)
    if (video.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        const onMeta = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("Erreur de chargement vidéo")); };
        const cleanup = () => {
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onError);
        };
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        video.addEventListener("error", onError, { once: true });
      });
    }

    const captured: CapturedFrame[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      try {
        const blob = await captureFrameAtTime(video, timestamps[i]);
        const objectUrl = URL.createObjectURL(blob);
        captured.push({ blob, objectUrl, timestamp: timestamps[i] });
        setCaptureProgress(i + 1);
        setFrames([...captured]);
      } catch (err) {
        console.error(`[YouTube] Capture failed at ${timestamps[i]}s`, err);
      }
    }

    if (captured.length === 0) {
      setError("Aucune frame capturée. La vidéo est peut-être protégée.");
      setStep("ready");
    } else {
      setStep("preview");
    }
  };

  // ── Upload frames + create collection ────────────────────────────────────

  const importFrames = async () => {
    if (!info || !frames.length) return;
    setStep("importing");
    setImportProgress(0);

    const inspirationIds: string[] = [];

    const uploadBlob = async (blob: Blob, filename: string): Promise<string | null> => {
      const formData = new FormData();
      formData.append("file", blob, filename);
      const res = await fetch("/api/upload/image", { method: "POST", body: formData });
      const data = await res.json();
      return data.inspirationId ?? null;
    };

    if (mode === "mosaic") {
      const mosaicBlob = await composeMosaic(frames);
      const id = await uploadBlob(mosaicBlob, "mosaic.jpg");
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
      // 5 stills
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const ts = formatDuration(frame.timestamp).replace(":", "m") + "s";
        const id = await uploadBlob(frame.blob, `still-${ts}.jpg`);
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

    // Auto-create a collection named after the video
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

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = () => {
    frames.forEach((f) => URL.revokeObjectURL(f.objectUrl));
    setFrames([]);
    setInfo(null);
    setStep("input");
    setUrl("");
    setCollectionId(null);
    setError(null);
    setCaptureProgress(0);
    setImportProgress(0);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const proxyUrl = info
    ? `/api/youtube/proxy?url=${encodeURIComponent(info.streamUrl)}`
    : "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      {/* Hidden video element — loaded once info is available */}
      {info && (
        <video
          ref={videoRef}
          src={proxyUrl}
          preload="metadata"
          muted
          playsInline
          className="sr-only"
          aria-hidden
        />
      )}

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

            {error && (
              <div className="space-y-1.5">
                <p className="text-xs text-red-400">{error}</p>
                {error.toLowerCase().includes("bot") ||
                  error.toLowerCase().includes("sign in") ? (
                  <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                    YouTube bloque les requêtes serveur sans session.{" "}
                    <a
                      href="https://github.com/distubejs/ytdl-core#cookies-support"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-[var(--text-secondary)] transition-colors"
                    >
                      Ajouter <code className="font-mono">YOUTUBE_COOKIE</code> dans les variables d&apos;environnement Vercel →
                    </a>
                  </p>
                ) : null}
              </div>
            )}

            <p className="text-[10px] text-[var(--text-tertiary)]">
              Supporte youtube.com/watch, youtu.be et les Shorts.
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
              </div>
              <button
                onClick={reset}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] self-start flex-shrink-0 text-xs transition-colors"
                title="Changer de vidéo"
              >
                ✕
              </button>
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
                    <div className="text-2xl mb-2 opacity-40 font-mono">
                      {m === "stills" ? "□□□□□" : "⊞"}
                    </div>
                    <p className="text-xs font-medium text-[var(--text-primary)]">
                      {m === "stills" ? "5 images séparées" : "Mosaïque 3×3"}
                    </p>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-relaxed">
                      {m === "stills"
                        ? "5 stills dans la bibliothèque, chacun lié au timestamp YouTube"
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
              Capturer {frameCount} frames →
            </button>
          </motion.div>
        )}

        {/* ── Step 3: Capturing in progress ── */}
        {step === "capturing" && info && (
          <motion.div
            key="capturing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-5"
          >
            <div className="flex items-center gap-3">
              <span className="w-4 h-4 rounded-full border-2 border-[var(--text-primary)] border-t-transparent animate-spin flex-shrink-0" />
              <p className="text-sm text-[var(--text-primary)]">
                Capture {captureProgress}/{frameCount}…
              </p>
            </div>

            {/* Live preview as frames arrive */}
            {frames.length > 0 && (
              <div
                className={cn(
                  "grid gap-2",
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
                    <img src={f.objectUrl} alt="" className="w-full h-full object-cover" />
                    <div className="absolute bottom-1 left-1 text-[8px] bg-black/55 text-white/90 px-1 py-0.5 rounded font-mono">
                      {formatDuration(f.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Step 4: Preview + confirm ── */}
        {step === "preview" && info && frames.length > 0 && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-5"
          >
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {frames.length} frame{frames.length > 1 ? "s" : ""} capturée{frames.length > 1 ? "s" : ""}
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                {mode === "mosaic"
                  ? "Ces 9 frames seront assemblées en une seule image 3×3."
                  : "Ces 5 images seront importées séparément, chacune liée à son timestamp."}
              </p>
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
                  <img src={f.objectUrl} alt="" className="w-full h-full object-cover" />
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
                ↺ Recapturer
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
