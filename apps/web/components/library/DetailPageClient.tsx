"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, ChevronLeft, ChevronRight, Copy, ClipboardPaste, Check, Minus, Plus, Maximize2 } from "lucide-react";
import { getImageUrl } from "@/lib/storage/urls";
import { MetadataPanel } from "@/components/inspiration/MetadataPanel";
import { GalleryStrip, type StripItem } from "@/components/library/GalleryStrip";
import { ImmersiveViewer } from "@/components/library/ImmersiveViewer";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetailPageData {
  id: string;
  title: string;
  mainImageStorageKey: string | null;
  mainImageId: string | null;
  initialData: {
    title: string;
    description: string;
    author: string;
    year: number | undefined;
    country: string;
    exposition: string;
    location: string;
    source: string;
    sourceUrl: string;
    categories: { categoryId: string; subcategoryId: string | null }[];
    tags: string[];
  };
  colorPalette: { id: string; hex: string; percentage: number; order: number }[];
  initialCollections: { id: string; name: string }[];
  initialVisit?: { id: string; place: string; exhibition: string | null; visitDate: string } | null;
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
        <img
          src={url}
          alt={title}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
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
            className="w-5 h-5 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={14} strokeWidth={2} />
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
  // Passé à GalleryStrip pour retarder son repli "toute la bibliothèque"
  // jusqu'à ce qu'on ait vraiment vérifié sessionStorage — sans ça,
  // GalleryStrip (descendant) exécute son effet de montage AVANT celui-ci
  // (les effets enfants s'exécutent avant ceux du parent) : il voit
  // `items.length === 0` (état initial, avant lecture) et démarre aussitôt
  // son fetch "toute la bibliothèque", qui écrase ensuite le contexte
  // correct une fois résolu — la navigation ←/→ retombait toujours sur la
  // bibliothèque entière malgré un contexte scoped valide en sessionStorage
  // (retour utilisateur : navigation contextuelle de la visionneuse).
  const [navContextChecked, setNavContextChecked] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  // Key trick: incrementing forces MetadataPanel to remount with new initialData after paste
  const [panelKey, setPanelKey] = useState(0);
  const [panelData, setPanelData] = useState(data.initialData);

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
      // Check if there's copied metadata available to paste
      if (sessionStorage.getItem("moodboard:copiedMeta")) {
        setHasCopied(true);
      }
    } catch {
      // sessionStorage unavailable
    } finally {
      // Dans TOUS les cas (contexte trouvé ou non, erreur ou non) — débloque
      // le repli whole-library de GalleryStrip une fois la vérif faite.
      setNavContextChecked(true);
    }
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

  // ── Copy metadata (in-app, via sessionStorage) ──
  const handleCopyMetadata = useCallback(() => {
    const d = panelData;
    try {
      const payload = {
        author:     d.author,
        year:       d.year,
        tags:       d.tags ?? [],
        categories: d.categories ?? [],
        sourceUrl:  d.sourceUrl,
        description: d.description,
      };
      sessionStorage.setItem("moodboard:copiedMeta", JSON.stringify(payload));
      setHasCopied(true);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sessionStorage unavailable */ }
  }, [panelData]);

  // ── Paste metadata onto current image ──
  const handlePasteMetadata = useCallback(async () => {
    try {
      const raw = sessionStorage.getItem("moodboard:copiedMeta");
      if (!raw) return;
      const payload = JSON.parse(raw) as {
        author?: string; year?: number;
        tags?: string[]; categories?: { categoryId: string; subcategoryId: string | null }[];
        sourceUrl?: string; description?: string;
      };
      // Merge onto current panelData (keep title, replace the rest)
      const merged = {
        ...panelData,
        author:      payload.author ?? panelData.author,
        year:        payload.year ?? panelData.year,
        tags:        payload.tags ?? panelData.tags,
        categories:  payload.categories ?? panelData.categories,
        sourceUrl:   payload.sourceUrl ?? panelData.sourceUrl,
        description: payload.description ?? panelData.description,
      };
      // Persist immediately via API
      await fetch(`/api/inspirations/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      // Remount MetadataPanel with new data
      setPanelData(merged);
      setPanelKey((k) => k + 1);
      setPasted(true);
      setTimeout(() => setPasted(false), 2000);
    } catch { /* error */ }
  }, [panelData, data.id]);

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
            className="flex-shrink-0 w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors">
            <ChevronLeft size={18} strokeWidth={2} />
          </Link>
        ) : (
          <span className="flex-shrink-0 w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center opacity-20 text-[var(--text-tertiary)]"><ChevronLeft size={18} strokeWidth={2} /></span>
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
            className="flex-shrink-0 w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors">
            <ChevronRight size={18} strokeWidth={2} />
          </Link>
        ) : (
          <span className="flex-shrink-0 w-9 h-9 sm:w-6 sm:h-6 flex items-center justify-center opacity-20 text-[var(--text-tertiary)]"><ChevronRight size={18} strokeWidth={2} /></span>
        )}

        <div className="w-px h-4 bg-[var(--border-subtle)] flex-shrink-0 hidden sm:block" />

        {/* Copy / Paste metadata — libellé complet sur desktop, icône seule sur mobile */}
        <button
          onClick={handleCopyMetadata}
          title="Copier les métadonnées (auteur, année, tags, catégories…)"
          className="flex items-center gap-1 h-9 px-2 sm:h-6 sm:px-1.5 rounded transition-colors flex-shrink-0 text-xs sm:text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
        >
          <span className="sm:hidden flex">{copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}</span>
          <span className="hidden sm:inline-flex items-center gap-1">{copied ? <><Check size={12} strokeWidth={2} /> Copié</> : <><Copy size={12} strokeWidth={1.75} /> Copier</>}</span>
        </button>
        {hasCopied && (
          <button
            onClick={handlePasteMetadata}
            title="Coller les métadonnées sur cette image"
            className="flex items-center gap-1 h-9 px-2 sm:h-6 sm:px-1.5 rounded transition-colors flex-shrink-0 text-xs sm:text-[10px] text-[var(--accent,#a78bfa)] hover:opacity-80 hover:bg-[var(--bg-surface)]"
          >
            <span className="sm:hidden flex">{pasted ? <Check size={14} strokeWidth={2} /> : <ClipboardPaste size={14} strokeWidth={1.75} />}</span>
            <span className="hidden sm:inline-flex items-center gap-1">{pasted ? <><Check size={12} strokeWidth={2} /> Collé</> : <><ClipboardPaste size={12} strokeWidth={1.75} /> Coller</>}</span>
          </button>
        )}

        <div className="w-px h-4 bg-[var(--border-subtle)] flex-shrink-0 hidden sm:block" />

        {/* Zoom controls */}
        <div className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
          <button onClick={zoomOut} disabled={zoomIdx === 0}
            className="w-6 h-6 flex items-center justify-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded disabled:opacity-20 transition-colors"
            title="Zoom arrière (−)"><Minus size={14} strokeWidth={2} /></button>
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
            title="Zoom avant (+)"><Plus size={14} strokeWidth={2} /></button>
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

      {/* ── Mobile layout : image sticky + metadata bottom sheet ──
          Swipe horizontal = image précédente/suivante ; le zoom se fait dans
          la visionneuse plein écran (tap sur l'image). */}
      <div
        className="md:hidden flex-1 min-h-0 overflow-y-auto"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Image pleine largeur — hauteur naturelle (plafonnée), tap = plein écran */}
        <div
          className="sticky top-0 z-0 w-full bg-[var(--bg-surface)] flex items-center justify-center"
          onClick={() => setImmersive(true)}
          role="button"
          aria-label="Voir en plein écran"
        >
          {data.mainImageStorageKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={data.id}
              src={getImageUrl(data.mainImageStorageKey)}
              alt={data.title}
              className="w-full h-auto object-contain"
              style={{ maxHeight: "62vh", minHeight: "180px" }}
              draggable={false}
            />
          ) : (
            <div className="w-full flex items-center justify-center" style={{ height: "40vw" }}>
              <span className="text-[var(--text-tertiary)] text-sm">Pas d&apos;image</span>
            </div>
          )}
          {/* Affordance plein écran */}
          <div className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <Maximize2 size={13} strokeWidth={1.6} className="text-white/85" />
          </div>
        </div>

        {/* Metadata bottom sheet — slide over image on scroll */}
        <div className="relative z-10 bg-[var(--bg-base)] rounded-t-2xl -mt-6 min-h-[50vh]">
          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="w-8 h-1 rounded-full bg-[var(--border-default)]" />
          </div>
          <MetadataPanel
            key={panelKey}
            id={data.id}
            initialData={panelData}
            colorPalette={data.colorPalette}
            imageStorageKey={data.mainImageStorageKey}
            imageId={data.mainImageId}
            initialCollections={data.initialCollections}
            initialVisit={data.initialVisit}
            scrollable={false}
          />
        </div>
      </div>

      {/* ── Desktop layout ── */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">

        {/* Image desktop — molette pour zoomer */}
        <div
          ref={imageAreaRef}
          className="relative flex-1 bg-[var(--bg-surface)] overflow-hidden flex items-center justify-center"
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

        {/* Metadata panel — sidebar desktop */}
        <div className={`flex-none w-80 border-l border-[var(--border-subtle)] flex flex-col ${panelHidden ? "hidden" : ""}`}>
          <MetadataPanel
            key={panelKey}
            id={data.id}
            initialData={panelData}
            colorPalette={data.colorPalette}
            imageStorageKey={data.mainImageStorageKey}
            imageId={data.mainImageId}
            initialCollections={data.initialCollections}
            initialVisit={data.initialVisit}
          />
        </div>
      </div>

      {/* ── Gallery strip ── */}
      <GalleryStrip
        currentId={data.id}
        items={stripItems}
        onFallback={handleFallback}
        navContextChecked={navContextChecked}
      />

      {/* ── Shortcuts overlay ── */}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

      {/* ── Visionneuse immersive plein écran (mobile : tap sur l'image) ── */}
      {immersive && (
        <ImmersiveViewer
          storageKey={data.mainImageStorageKey}
          title={data.title}
          counter={
            currentIdx !== -1 && stripItems.length > 0
              ? `${currentIdx + 1} / ${stripItems.length}`
              : undefined
          }
          onClose={() => setImmersive(false)}
          onPrev={prevItem ? () => router.replace(`/library/${prevItem.id}`) : null}
          onNext={nextItem ? () => router.replace(`/library/${nextItem.id}`) : null}
          currentThumbKey={currentIdx !== -1 ? stripItems[currentIdx]?.thumbnailKey : null}
          prevThumbKey={prevItem?.thumbnailKey}
          nextThumbKey={nextItem?.thumbnailKey}
        />
      )}
    </div>
  );
}
