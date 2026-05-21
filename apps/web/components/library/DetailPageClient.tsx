"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

// ─── Zoomable image with fade-in on load ─────────────────────────────────────

function ZoomableImage({ storageKey, title, zoom }: {
  storageKey: string | null;
  title: string;
  zoom: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const url = storageKey ? getImageUrl(storageKey) : null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ transform: `scale(${zoom})`, transformOrigin: "center center", transition: "transform 0.18s ease" }}
    >
      {url ? (
        <Image
          src={url}
          alt={title}
          fill
          priority
          className={`object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 70vw, 60vw"
        />
      ) : (
        <span className="text-[var(--text-tertiary)] text-sm">Pas d&apos;image</span>
      )}
    </div>
  );
}

// ─── Zoom levels ──────────────────────────────────────────────────────────────

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
const DEFAULT_ZOOM_IDX = 5; // 1.0

function formatZoom(z: number) {
  return `${Math.round(z * 100)}%`;
}

// ─── Shortcuts overlay ────────────────────────────────────────────────────────

const SHORTCUTS = [
  { keys: ["←", "→"], label: "Image précédente / suivante" },
  { keys: ["+", "−"], label: "Zoom avant / arrière" },
  { keys: ["0"], label: "Réinitialiser le zoom" },
  { keys: ["p"], label: "Masquer / afficher le panneau" },
  { keys: ["?"], label: "Afficher / masquer les raccourcis" },
  { keys: ["⌘ Scroll", "Pinch"], label: "Zoom à la molette / geste" },
];

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "?") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end p-4 md:p-6 pointer-events-none"
      aria-label="Raccourcis clavier"
    >
      <div className="pointer-events-auto bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-xl shadow-2xl p-4 w-72 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-[var(--text-primary)]">Raccourcis</p>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-xs"
          >
            ✕
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map(({ keys, label }) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-[var(--text-secondary)]">{label}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="px-1.5 py-0.5 text-[10px] font-mono bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[var(--text-tertiary)] leading-none"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  data: DetailPageData;
  onClose?: () => void;
  isModal?: boolean;
}

export function DetailPageClient({ data, onClose, isModal }: Props) {
  const router = useRouter();

  // ── State ──
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_IDX);
  const [panelHidden, setPanelHidden] = useState(false);
  const [stripItems, setStripItems] = useState<StripItem[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Persist panel visibility across navigations
  const togglePanel = useCallback(() => {
    setPanelHidden((prev) => {
      const next = !prev;
      try { sessionStorage.setItem("moodboard:panelHidden", String(next)); } catch {}
      return next;
    });
  }, []);

  // Refs
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const pinchStartDist = useRef<number | null>(null);
  const lastWheelTime = useRef(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // ── Restore persisted preferences on mount ──
  useEffect(() => {
    try {
      // Nav context
      const raw = sessionStorage.getItem("moodboard:libraryNav");
      if (raw) {
        const ctx = JSON.parse(raw) as { items: StripItem[] };
        setStripItems(ctx.items ?? []);
      }
      // Panel hidden state
      if (sessionStorage.getItem("moodboard:panelHidden") === "true") {
        setPanelHidden(true);
      }
    } catch { /* sessionStorage unavailable */ }
  }, []);

  // ── Derive prev / next from strip order ──
  const currentIdx = stripItems.findIndex((item) => item.id === data.id);
  const prevItem = currentIdx > 0 ? stripItems[currentIdx - 1] : null;
  const nextItem = currentIdx !== -1 && currentIdx < stripItems.length - 1 ? stripItems[currentIdx + 1] : null;

  const zoom = ZOOM_LEVELS[zoomIdx];
  const isZoomed = zoomIdx !== DEFAULT_ZOOM_IDX;

  const zoomIn  = useCallback(() => setZoomIdx((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1)), []);
  const zoomOut = useCallback(() => setZoomIdx((i) => Math.max(i - 1, 0)), []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

      switch (e.key) {
        case "ArrowLeft":  e.preventDefault(); if (prevItem) router.replace(`/library/${prevItem.id}`); break;
        case "ArrowRight": e.preventDefault(); if (nextItem) router.replace(`/library/${nextItem.id}`); break;
        case "+": case "=": zoomIn(); break;
        case "-": zoomOut(); break;
        case "0": setZoomIdx(DEFAULT_ZOOM_IDX); break;
        case "p": togglePanel(); break;
        case "?": setShowShortcuts((v) => !v); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prevItem, nextItem, router, zoomIn, zoomOut]);

  // ── Mouse wheel / trackpad scroll zoom (non-passive to allow preventDefault) ──
  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelTime.current < 80) return;
      lastWheelTime.current = now;
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoomIn, zoomOut]);

  // ── Touch: swipe (1 doigt) = navigation, pinch (2 doigts) = zoom ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.sqrt(dx * dx + dy * dy);
      touchStartX.current = null; // annule le swipe si pinch
    } else if (e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || pinchStartDist.current === null) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = dist / pinchStartDist.current;
    if (ratio > 1.25) { zoomIn();  pinchStartDist.current = dist; }
    else if (ratio < 0.8) { zoomOut(); pinchStartDist.current = dist; }
  }, [zoomIn, zoomOut]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    pinchStartDist.current = null;
    if (touchStartX.current !== null && e.changedTouches.length > 0) {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const dy = e.changedTouches[0].clientY - (touchStartY.current ?? 0);
      // Swipe horizontal : > 50px et plus horizontal que vertical
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0 && nextItem) router.replace(`/library/${nextItem.id}`);
        else if (dx > 0 && prevItem) router.replace(`/library/${prevItem.id}`);
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [prevItem, nextItem, router]);

  const handleFallback = useCallback((items: StripItem[]) => setStripItems(items), []);

  // ── Render ──
  return (
    <div className={`flex flex-col ${isModal ? "h-full" : "md:h-screen"} overflow-hidden`}>

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center gap-2 min-w-0">

        {/* Back / close */}
        {onClose ? (
          <button onClick={onClose} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0">
            ← Bibliothèque
          </button>
        ) : (
          <Link href="/library" className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0">
            ← Bibliothèque
          </Link>
        )}

        <span className="text-[var(--border-default)] text-xs flex-shrink-0">/</span>

        {/* Prev */}
        {prevItem ? (
          <Link href={`/library/${prevItem.id}`} replace title={`← ${prevItem.title}`}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors text-sm">
            ‹
          </Link>
        ) : (
          <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center opacity-20 text-[var(--text-tertiary)] text-sm">‹</span>
        )}

        {/* Title + counter */}
        <span className="text-xs text-[var(--text-secondary)] truncate flex-1 min-w-0">{data.title}</span>
        {currentIdx !== -1 && stripItems.length > 0 && (
          <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
            {currentIdx + 1}&thinsp;/&thinsp;{stripItems.length}
          </span>
        )}

        {/* Next */}
        {nextItem ? (
          <Link href={`/library/${nextItem.id}`} replace title={`${nextItem.title} →`}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors text-sm">
            ›
          </Link>
        ) : (
          <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center opacity-20 text-[var(--text-tertiary)] text-sm">›</span>
        )}

        <div className="w-px h-4 bg-[var(--border-subtle)] flex-shrink-0 hidden sm:block" />

        {/* Zoom controls */}
        <div className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
          <button onClick={zoomOut} disabled={zoomIdx === 0}
            className="w-6 h-6 flex items-center justify-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded disabled:opacity-20 transition-colors"
            title="Zoom arrière (−)">−</button>
          <button
            onClick={() => isZoomed && setZoomIdx(DEFAULT_ZOOM_IDX)}
            className={`px-1.5 h-6 text-[10px] rounded transition-colors tabular-nums min-w-[2.75rem] text-center ${
              isZoomed ? "text-[var(--accent,#a78bfa)] hover:bg-[var(--bg-surface)] cursor-pointer" : "text-[var(--text-tertiary)] cursor-default"
            }`}
            title={isZoomed ? "Réinitialiser (0)" : undefined}>
            {formatZoom(zoom)}
          </button>
          <button onClick={zoomIn} disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            className="w-6 h-6 flex items-center justify-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded disabled:opacity-20 transition-colors"
            title="Zoom avant (+)">+</button>
        </div>

        <div className="w-px h-4 bg-[var(--border-subtle)] flex-shrink-0 hidden sm:block" />

        {/* Panel toggle — desktop */}
        <button onClick={togglePanel}
          title={panelHidden ? "Afficher le panneau (p)" : "Masquer le panneau (p)"}
          className="hidden md:flex w-6 h-6 items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors flex-shrink-0 text-[11px]">
          {panelHidden ? "⊞" : "⊟"}
        </button>

        {/* Shortcuts button */}
        <button
          onClick={() => setShowShortcuts((v) => !v)}
          title="Raccourcis clavier (?)"
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors flex-shrink-0 text-[11px] hidden sm:flex ${
            showShortcuts
              ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          }`}
        >
          ?
        </button>
      </div>

      {/* ── Image mobile — swipe pour naviguer, pinch pour zoomer ── */}
      <div
        className="md:hidden flex-shrink-0 relative w-full aspect-video bg-[var(--bg-surface)] overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <ZoomableImage key={data.id} storageKey={data.mainImageStorageKey} title={data.title} zoom={zoom} />
        {isZoomed && (
          <div className="absolute bottom-3 right-3 px-2 py-0.5 bg-black/50 text-white/60 text-[10px] rounded font-mono pointer-events-none select-none backdrop-blur-sm">
            {formatZoom(zoom)}
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row md:overflow-hidden">

        {/* Image desktop — molette pour zoomer */}
        <div
          ref={imageAreaRef}
          className="hidden md:flex relative flex-1 bg-[var(--bg-surface)] overflow-hidden items-center justify-center"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <ZoomableImage key={data.id} storageKey={data.mainImageStorageKey} title={data.title} zoom={zoom} />
          {isZoomed && (
            <div className="absolute bottom-3 right-3 px-2 py-0.5 bg-black/50 text-white/60 text-[10px] rounded font-mono pointer-events-none select-none backdrop-blur-sm">
              {formatZoom(zoom)}
            </div>
          )}
        </div>

        {/* Metadata panel — scrollable sur mobile */}
        <div className={`flex-1 min-h-0 overflow-y-auto md:flex-none md:w-80 border-t md:border-t-0 md:border-l border-[var(--border-subtle)] flex flex-col ${panelHidden ? "md:hidden" : ""}`}>
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

      {/* ── Shortcuts overlay ── */}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
