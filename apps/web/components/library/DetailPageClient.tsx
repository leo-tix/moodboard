"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getImageUrl } from "@/lib/storage/urls";
import { MetadataPanel } from "@/components/inspiration/MetadataPanel";
import { GalleryStrip, type StripItem } from "@/components/library/GalleryStrip";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetailPageData {
  id: string;
  title: string;
  mainImageStorageKey: string | null;
  initialData: {
    title: string;
    description: string;
    author: string;
    studio: string;
    year: number | undefined;
    country: string;
    exposition: string;
    location: string;
    source: string;
    notes: string;
    sourceUrl: string;
    categories: { categoryId: string; subcategoryId: string | null }[];
    tags: string[];
  };
  colorPalette: { id: string; hex: string; percentage: number; order: number }[];
  aiAnalysis: { moodDescriptor: string | null; styleKeywords: string[] } | null;
  initialCollections: { id: string; name: string }[];
}

// ─── Zoom levels ──────────────────────────────────────────────────────────────

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
const DEFAULT_ZOOM_IDX = 5; // 1.0 = 100%

function formatZoom(z: number) {
  return z === 1 ? "100%" : `${Math.round(z * 100)}%`;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  data: DetailPageData;
}

export function DetailPageClient({ data }: Props) {
  const router = useRouter();

  // ── State ──
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_IDX);
  const [panelHidden, setPanelHidden] = useState(false);
  const [stripItems, setStripItems] = useState<StripItem[]>([]);

  // ── Load nav context from sessionStorage ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("moodboard:libraryNav");
      if (raw) {
        const ctx = JSON.parse(raw) as { items: StripItem[] };
        setStripItems(ctx.items ?? []);
      }
    } catch {
      // sessionStorage unavailable or invalid JSON — fallback handled by GalleryStrip
    }
  }, []);

  // ── Derive prev / next ──
  const currentIdx = stripItems.findIndex((item) => item.id === data.id);
  const prevItem = currentIdx > 0 ? stripItems[currentIdx - 1] : null;
  const nextItem = currentIdx !== -1 && currentIdx < stripItems.length - 1 ? stripItems[currentIdx + 1] : null;

  const zoom = ZOOM_LEVELS[zoomIdx];
  const isZoomed = zoomIdx !== DEFAULT_ZOOM_IDX;

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire while the user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (prevItem) router.push(`/library/${prevItem.id}`);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (nextItem) router.push(`/library/${nextItem.id}`);
          break;
        case "+":
        case "=":
          setZoomIdx((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1));
          break;
        case "-":
          setZoomIdx((i) => Math.max(i - 1, 0));
          break;
        case "0":
          setZoomIdx(DEFAULT_ZOOM_IDX);
          break;
        case "p":
          setPanelHidden((v) => !v);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prevItem, nextItem, router]);

  const handleFallback = useCallback((items: StripItem[]) => setStripItems(items), []);

  const mainImageUrl = data.mainImageStorageKey ? getImageUrl(data.mainImageStorageKey) : null;

  // ── Render ──
  return (
    <div className="flex flex-col md:h-screen">

      {/* ── Breadcrumb / top bar ── */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center gap-2 min-w-0">

        {/* Back link */}
        <Link
          href="/library"
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
        >
          ← Bibliothèque
        </Link>

        <span className="text-[var(--border-default)] text-xs flex-shrink-0">/</span>

        {/* Prev arrow */}
        {prevItem ? (
          <Link
            href={`/library/${prevItem.id}`}
            title={`← ${prevItem.title}`}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors text-sm"
          >
            ‹
          </Link>
        ) : (
          <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)]/20 text-sm">‹</span>
        )}

        {/* Title + counter */}
        <span className="text-xs text-[var(--text-secondary)] truncate flex-1 min-w-0">{data.title}</span>
        {currentIdx !== -1 && stripItems.length > 0 && (
          <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
            {currentIdx + 1} / {stripItems.length}
          </span>
        )}

        {/* Next arrow */}
        {nextItem ? (
          <Link
            href={`/library/${nextItem.id}`}
            title={`${nextItem.title} →`}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors text-sm"
          >
            ›
          </Link>
        ) : (
          <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)]/20 text-sm">›</span>
        )}

        {/* Divider */}
        <div className="w-px h-4 bg-[var(--border-subtle)] flex-shrink-0 hidden sm:block" />

        {/* ── Zoom controls ── */}
        <div className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => setZoomIdx((i) => Math.max(i - 1, 0))}
            disabled={zoomIdx === 0}
            className="w-6 h-6 flex items-center justify-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded disabled:opacity-20 transition-colors"
            title="Zoom arrière (−)"
          >
            −
          </button>
          <button
            onClick={() => isZoomed && setZoomIdx(DEFAULT_ZOOM_IDX)}
            className={`px-1.5 h-6 text-[10px] rounded transition-colors tabular-nums min-w-[2.5rem] text-center ${
              isZoomed
                ? "text-[var(--accent,#a78bfa)] hover:bg-[var(--bg-surface)] cursor-pointer"
                : "text-[var(--text-tertiary)] cursor-default"
            }`}
            title={isZoomed ? "Réinitialiser le zoom (0)" : undefined}
          >
            {formatZoom(zoom)}
          </button>
          <button
            onClick={() => setZoomIdx((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1))}
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            className="w-6 h-6 flex items-center justify-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded disabled:opacity-20 transition-colors"
            title="Zoom avant (+)"
          >
            +
          </button>
        </div>

        {/* ── Panel toggle (desktop only) ── */}
        <button
          onClick={() => setPanelHidden((v) => !v)}
          title={panelHidden ? "Afficher le panneau (p)" : "Masquer le panneau (p)"}
          className="hidden md:flex w-6 h-6 items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors flex-shrink-0 text-[11px]"
        >
          {panelHidden ? "⊞" : "⊟"}
        </button>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-col md:flex-row md:flex-1 md:overflow-hidden">

        {/* Image area */}
        <div className="relative w-full aspect-video md:aspect-auto md:flex-1 bg-[var(--bg-surface)] overflow-hidden flex items-center justify-center">
          {mainImageUrl ? (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
                transition: "transform 0.2s ease",
              }}
            >
              <Image
                src={mainImageUrl}
                alt={data.title}
                fill
                className="object-contain"
                priority
                sizes="(max-width: 768px) 100vw, (max-width: 1280px) 70vw, 60vw"
              />
            </div>
          ) : (
            <span className="text-[var(--text-tertiary)] text-sm">Pas d&apos;image</span>
          )}

          {/* Zoom hint when zoomed in */}
          {zoomIdx > DEFAULT_ZOOM_IDX && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-black/60 text-white/60 text-[10px] rounded-full backdrop-blur-sm pointer-events-none">
              {formatZoom(zoom)} — appuie sur 0 pour réinitialiser
            </div>
          )}
        </div>

        {/* Metadata panel */}
        <div
          className={`
            w-full md:w-80 md:flex-shrink-0
            border-t md:border-t-0 md:border-l border-[var(--border-subtle)]
            overflow-y-auto flex flex-col
            ${panelHidden ? "md:hidden" : ""}
          `}
        >
          <MetadataPanel
            id={data.id}
            initialData={data.initialData}
            colorPalette={data.colorPalette}
            aiAnalysis={data.aiAnalysis}
            initialCollections={data.initialCollections}
          />
        </div>
      </div>

      {/* ── Gallery strip ── */}
      <GalleryStrip
        currentId={data.id}
        items={stripItems}
        onFallback={handleFallback}
      />
    </div>
  );
}
