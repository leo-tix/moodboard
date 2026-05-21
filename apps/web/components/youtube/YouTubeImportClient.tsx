"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { YouTubeMetadata } from "@/app/api/youtube/metadata/route";

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

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new File([bytes], filename, { type: mimeType });
}

function compileNotes(meta: YouTubeMetadata): string {
  const parts: string[] = [];
  if (meta.dop) parts.push(`DoP : ${meta.dop}`);
  if (meta.music) parts.push(`Musique : ${meta.music}`);
  if (meta.cast?.length) parts.push(`Cast : ${meta.cast.join(", ")}`);
  if (meta.notes) parts.push(meta.notes);
  return parts.join(" · ");
}

// ─── Component ────────────────────────────────────────────────────────────────

export function YouTubeImportClient() {
  const [url, setUrl] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);

  // Metadata (director, year, studio…) — loaded async after info
  const [metadata, setMetadata] = useState<YouTubeMetadata | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [mode, setMode] = useState<Mode>("stills");

  // AI analysis toggle — OFF by default, same as the rest of the platform
  const [aiEnabled, setAiEnabled] = useState(false);

  // Collection
  const [createCollection, setCreateCollection] = useState(true);
  const [collectionName, setCollectionName] = useState("");

  const [step, setStep] = useState<Step>("input");
  const [importStatus, setImportStatus] = useState("");
  const [importProgress, setImportProgress] = useState<number>(0); // 0–totalSteps
  const [importTotal, setImportTotal] = useState<number>(1);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Load video info then metadata ─────────────────────────────────────────

  const loadInfo = async () => {
    if (!url.trim()) return;
    setLoadingInfo(true);
    setError(null);
    setMetadata(null);
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
      const videoInfo = data as VideoInfo;
      setInfo(videoInfo);
      setCollectionName(videoInfo.title);
      setStep("ready");

      // Fetch metadata in background (non-blocking)
      fetchMetadata(videoInfo.videoId, videoInfo.title, videoInfo.author);
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoadingInfo(false);
    }
  };

  const fetchMetadata = async (videoId: string, title: string, author: string) => {
    setLoadingMeta(true);
    try {
      const res = await fetch("/api/youtube/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, title, author }),
      });
      const data = await res.json();
      if (res.ok && data.available) {
        setMetadata(data as YouTubeMetadata);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingMeta(false);
    }
  };

  // ── Import: fetch frames → upload → analyze IA → (optional) collection ────

  const importFrames = async () => {
    if (!info) return;
    setStep("importing");
    setError(null);

    try {
      // 1. Fetch frames from server (download + resize YouTube thumbnails)
      setImportStatus("Chargement des images…");
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

      // Helper: upload a File and return its inspirationId
      const uploadFile = async (file: File): Promise<string | null> => {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload/image", { method: "POST", body: formData });
        const data = await res.json();
        return (data.inspirationId as string) ?? null;
      };

      // Helper: PATCH inspiration with metadata + AI suggestions
      const patchInspiration = async (
        id: string,
        title: string,
        sourceUrl: string,
        extraTags: string[] = [],
        extraCategories: { categoryId: string }[] = []
      ) => {
        const notes = metadata ? compileNotes(metadata) : undefined;
        await fetch(`/api/inspirations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            source: "YouTube",
            sourceUrl,
            author: metadata?.director ?? info.author ?? undefined,
            year: metadata?.year ?? undefined,
            studio: metadata?.studio ?? undefined,
            country: metadata?.country ?? undefined,
            notes: notes || undefined,
            tags: extraTags.length ? extraTags : undefined,
            categories: extraCategories.length ? extraCategories : undefined,
          }),
        });
      };

      // Helper: analyze an inspiration and return suggested tags + categories
      const analyzeInspiration = async (
        id: string
      ): Promise<{ tags: string[]; categories: { categoryId: string }[] }> => {
        try {
          const res = await fetch(`/api/inspirations/${id}/analyze`, { method: "POST" });
          if (!res.ok) return { tags: [], categories: [] };
          const data = await res.json();
          return {
            tags: (data.suggestedTags as string[]) ?? [],
            categories:
              (data.suggestedCategories as { id: string }[])?.map((c) => ({
                categoryId: c.id,
              })) ?? [],
          };
        } catch {
          return { tags: [], categories: [] };
        }
      };

      const inspirationIds: string[] = [];

      if (mode === "mosaic") {
        setImportTotal(2); // upload + analyze

        setImportStatus("Composition de la mosaïque…");
        const file = dataUrlToFile(framesData.dataUrl, "mosaic.jpg");
        const id = await uploadFile(file);
        if (id) {
          setImportProgress(1);
          let aiTags: string[] = [];
          let aiCategories: { categoryId: string }[] = [];
          if (aiEnabled) {
            setImportStatus("Analyse IA…");
            const result = await analyzeInspiration(id);
            aiTags = result.tags;
            aiCategories = result.categories;
          }
          const allTags = [...(metadata?.tags ?? []), ...aiTags];
          await patchInspiration(
            id,
            info.title,
            `https://youtube.com/watch?v=${info.videoId}`,
            allTags,
            aiCategories
          );
          inspirationIds.push(id);
        }
        setImportProgress(2);
      } else {
        const frames = framesData.frames as { dataUrl: string; label: string }[];
        setImportTotal(frames.length * 2); // upload + analyze per frame

        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          setImportStatus(`Import ${i + 1} / ${frames.length}…`);
          const file = dataUrlToFile(
            frame.dataUrl,
            `still-${frame.label.replace(/[^a-z0-9]/gi, "_")}.jpg`
          );
          const id = await uploadFile(file);
          if (id) {
            setImportProgress(i * 2 + 1);
            let aiTags: string[] = [];
            let aiCategories: { categoryId: string }[] = [];
            if (aiEnabled) {
              setImportStatus(`Analyse IA ${i + 1} / ${frames.length}…`);
              const result = await analyzeInspiration(id);
              aiTags = result.tags;
              aiCategories = result.categories;
            }
            const allTags = [...(metadata?.tags ?? []), ...aiTags];
            await patchInspiration(
              id,
              `${info.title} — ${frame.label}`,
              `https://youtube.com/watch?v=${info.videoId}`,
              allTags,
              aiCategories
            );
            inspirationIds.push(id);
          }
          setImportProgress(i * 2 + 2);
        }
      }

      // 4. Optionally create collection
      if (createCollection && collectionName.trim() && inspirationIds.length > 0) {
        setImportStatus("Création de la collection…");
        const colRes = await fetch("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: collectionName.trim(),
            description: `${info.author} · Import YouTube`,
          }),
        });
        const col = await colRes.json();
        await fetch(`/api/collections/${col.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inspirationIds }),
        });
        setCollectionId(col.id as string);
      }

      setStep("done");
    } catch {
      setError("Erreur réseau lors de l'import");
      setStep("ready");
    }
  };

  const reset = () => {
    setInfo(null);
    setMetadata(null);
    setStep("input");
    setUrl("");
    setCollectionId(null);
    setCollectionName("");
    setError(null);
    setImportStatus("");
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
                  {loadingInfo ? "Chargement…" : "Analyser"}
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Importe les 4 captures auto-générées + extrait les métadonnées via IA.
            </p>
          </motion.div>
        )}

        {/* ── Step 2: Video info + frames + metadata + collection ── */}
        {step === "ready" && info && (
          <motion.div
            key="ready"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-5"
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
                <p className="text-xs text-[var(--text-tertiary)] mt-1">{info.author}</p>
              </div>
              <button
                onClick={reset}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] self-start flex-shrink-0 text-xs transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Metadata */}
            <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)]">
                <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest">
                  Métadonnées extraites
                </p>
                {loadingMeta && (
                  <span className="w-3 h-3 rounded-full border border-[var(--text-tertiary)] border-t-transparent animate-spin" />
                )}
              </div>

              {metadata ? (
                <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2">
                  {[
                    { label: "Réalisateur", value: metadata.director },
                    { label: "Année", value: metadata.year?.toString() },
                    { label: "Studio", value: metadata.studio },
                    { label: "Pays", value: metadata.country },
                    { label: "DoP", value: metadata.dop },
                    { label: "Musique", value: metadata.music },
                  ]
                    .filter((f) => f.value)
                    .map((f) => (
                      <div key={f.label}>
                        <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest">
                          {f.label}
                        </p>
                        <p className="text-xs text-[var(--text-primary)] mt-0.5 truncate">
                          {f.value}
                        </p>
                      </div>
                    ))}
                  {metadata.cast?.length > 0 && (
                    <div className="col-span-2">
                      <p className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest">
                        Cast
                      </p>
                      <p className="text-xs text-[var(--text-primary)] mt-0.5">
                        {metadata.cast.join(", ")}
                      </p>
                    </div>
                  )}
                  {metadata.tags?.length > 0 && (
                    <div className="col-span-2 flex flex-wrap gap-1 mt-1">
                      {metadata.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[9px] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border border-[var(--border-subtle)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-4 py-3">
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    {loadingMeta
                      ? "Extraction en cours…"
                      : "Aucune métadonnée extraite"}
                  </p>
                </div>
              )}
            </div>

            {/* Frame previews */}
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
                    <img src={src} alt={info.frameLabels[i]} className="w-full h-full object-cover" />
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
                        ? "4 stills analysés par IA individuellement"
                        : "1 image composite 960×540 — analysée par IA"}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Collection toggle */}
            <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
              <button
                onClick={() => setCreateCollection(!createCollection)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <div className="text-left">
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    Créer une collection
                  </p>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    Regroupe ces images dans une collection dédiée
                  </p>
                </div>
                {/* Toggle — inline-block knob, same pattern as AI toggle */}
                <div
                  role="switch"
                  aria-checked={createCollection}
                  className={cn(
                    "relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
                    createCollection ? "bg-[var(--text-primary)]" : "bg-[var(--bg-overlay)]"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                      createCollection ? "translate-x-3" : "translate-x-0"
                    )}
                  />
                </div>
              </button>

              <AnimatePresence>
                {createCollection && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden border-t border-[var(--border-subtle)]"
                  >
                    <div className="px-4 py-3">
                      <input
                        className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] rounded-md px-3 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors"
                        value={collectionName}
                        onChange={(e) => setCollectionName(e.target.value)}
                        placeholder="Nom de la collection"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* AI toggle — OFF by default, same as rest of platform */}
            <div
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-colors",
                aiEnabled
                  ? "border-[var(--accent,#a78bfa)]/30 bg-[var(--accent,#a78bfa)]/5"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              )}
            >
              <button
                type="button"
                role="switch"
                aria-checked={aiEnabled}
                onClick={() => setAiEnabled((v) => !v)}
                className={cn(
                  "relative mt-0.5 inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
                  aiEnabled ? "bg-[var(--accent,#a78bfa)]" : "bg-[var(--bg-overlay)]"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                    aiEnabled ? "translate-x-3" : "translate-x-0"
                  )}
                />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      aiEnabled ? "text-[var(--accent,#a78bfa)]" : "text-[var(--text-secondary)]"
                    )}
                  >
                    ✦ Analyse IA automatique
                  </span>
                  <span
                    className={cn(
                      "text-[8px] px-1 py-0.5 rounded-full",
                      aiEnabled
                        ? "bg-[var(--accent,#a78bfa)]/20 text-[var(--accent,#a78bfa)]"
                        : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
                    )}
                  >
                    {aiEnabled ? "ON" : "OFF"}
                  </span>
                </div>
                <p className="text-[9px] text-[var(--text-tertiary)] leading-relaxed mt-0.5">
                  {aiEnabled ? (
                    <span className="text-[var(--accent,#a78bfa)]/80">
                      Titre, tags et catégories appliqués automatiquement via Gemini.
                    </span>
                  ) : (
                    "Activer pour que Gemini analyse chaque image (tags, catégories). Données transmises à Google (hors UE)."
                  )}
                </p>
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={importFrames}
              className="w-full py-2.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {aiEnabled
                ? `Importer + analyser ${mode === "mosaic" ? "la mosaïque" : "les 4 images"} →`
                : `Importer ${mode === "mosaic" ? "la mosaïque" : "les 4 images"} →`}
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
            className="py-20 flex flex-col items-center gap-5 text-center"
          >
            <span className="w-8 h-8 rounded-full border-2 border-[var(--text-primary)] border-t-transparent animate-spin" />
            <div>
              <p className="text-sm text-[var(--text-primary)]">{importStatus}</p>
              {importTotal > 1 && (
                <div className="mt-3 w-48 mx-auto bg-[var(--bg-elevated)] rounded-full h-1">
                  <div
                    className="bg-[var(--text-primary)] h-1 rounded-full transition-all duration-300"
                    style={{ width: `${(importProgress / importTotal) * 100}%` }}
                  />
                </div>
              )}
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
              <p className="text-lg font-light text-[var(--text-primary)]">Import terminé</p>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">
                {mode === "mosaic" ? "Mosaïque créée" : "4 images importées"}
                {aiEnabled ? " · Analysées par IA" : ""}
                {createCollection && collectionId ? " · Collection créée" : ""}
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
              <Link
                href="/library"
                className="px-4 py-2 border border-[var(--border-default)] text-[var(--text-secondary)] rounded-md text-sm hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
              >
                Bibliothèque
              </Link>
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
