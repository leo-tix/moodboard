"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ScanText, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { runCartelOcr, type CartelFields } from "@/lib/visits/cartelOcr";

// Recadrage AVANT OCR (retour utilisateur 2026-07-19) : l'utilisateur cadre la
// zone du cartel pour que Tesseract se concentre dessus (moins de bruit = bien
// meilleure lecture). La photo n'est PAS stockée : elle sert uniquement à l'OCR
// puis est jetée (le module cartel n'affiche pas d'image).
//
// Le cadre est exprimé en FRACTIONS (0..1) de l'image, pas en pixels affichés
// (retour utilisateur 2026-10-16 : imprécis quand le cartel a été photographié
// de loin et apparaît petit). Ça permet deux choses : le cadre reste valide
// quel que soit le zoom ou un redimensionnement du conteneur (plus besoin de
// le réinitialiser), et on peut zoomer l'image affichée (boutons +/-, dans un
// conteneur défilable) pour agrandir la zone à cadrer sans que la conversion
// vers les pixels de la photo originale change.

interface Box { x: number; y: number; w: number; h: number } // fractions 0..1
type Drag = { mode: "move" | "nw" | "ne" | "sw" | "se"; startX: number; startY: number; box: Box } | null;
const MIN_PX = 40; // taille mini du cadre, en pixels affichés (converti en fraction à la volée)
const OUT_MAX = 1600; // largeur max du recadrage envoyé à l'OCR
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

export function CartelScanModal({
  file,
  onCancel,
  onResult,
  onResultRaw,
  title = "Recadrer le cartel",
  actionLabel = "Analyser",
  hint = "Cadre la zone du cartel puis « Analyser » — la photo n'est pas conservée.",
}: {
  file: File;
  onCancel: () => void;
  /** Retour STRUCTURÉ (cartel/photo). */
  onResult?: (fields: CartelFields) => void;
  /** Retour TEXTE BRUT (module texte — récupérer tout un panneau). */
  onResultRaw?: (raw: string) => void;
  title?: string;
  actionLabel?: string;
  hint?: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [zoom, setZoom] = useState(1);
  // Taille affichée (CSS px) de l'image à zoom 1 (ajustée au conteneur) —
  // base à partir de laquelle le zoom agrandit l'image dans le conteneur
  // défilable, sans jamais toucher au calcul fraction→pixels du cadre.
  const baseSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<Drag>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const initBox = useCallback(() => {
    setBox({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 });
  }, []);

  // Mesure la taille "ajustée" (zoom 1) de l'image une fois chargée, pour
  // servir de base au zoom. Un changement de taille du conteneur (rotation
  // d'écran) la remesure — le cadre, en fractions, reste valide sans recalage.
  const measureBase = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    // À zoom 1, l'image est dimensionnée par la classe CSS (object-fit via
    // max-w-full/max-h) : on lit sa taille réelle rendue.
    const w = img.clientWidth, h = img.clientHeight;
    if (w > 0 && h > 0) {
      baseSizeRef.current = { w, h };
      setDisplaySize({ w: w * zoom, h: h * zoom });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!imgRef.current) return;
    const ro = new ResizeObserver(() => { if (zoom === 1) measureBase(); });
    ro.observe(imgRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const base = baseSizeRef.current;
    if (base) setDisplaySize({ w: base.w * zoom, h: base.h * zoom });
  }, [zoom]);

  const changeZoom = (delta: number) => {
    setZoom((z) => {
      const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10));
      return nz;
    });
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const img = imgRef.current;
      if (!d || !img) return;
      e.preventDefault();
      const cw = img.clientWidth, ch = img.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      const minFracW = MIN_PX / cw, minFracH = MIN_PX / ch;
      const dx = (e.clientX - d.startX) / cw, dy = (e.clientY - d.startY) / ch;
      const b = { ...d.box };
      if (d.mode === "move") {
        b.x = Math.max(0, Math.min(1 - b.w, d.box.x + dx));
        b.y = Math.max(0, Math.min(1 - b.h, d.box.y + dy));
      } else {
        // Redimensionnement par coin — on borne pour rester dans l'image + taille mini.
        let { x, y, w, h } = d.box;
        if (d.mode.includes("w")) { const nx = Math.max(0, Math.min(x + w - minFracW, x + dx)); w += x - nx; x = nx; }
        if (d.mode.includes("e")) { w = Math.max(minFracW, Math.min(1 - x, w + dx)); }
        if (d.mode.includes("n")) { const ny = Math.max(0, Math.min(y + h - minFracH, y + dy)); h += y - ny; y = ny; }
        if (d.mode.includes("s")) { h = Math.max(minFracH, Math.min(1 - y, h + dy)); }
        b.x = x; b.y = y; b.w = w; b.h = h;
      }
      setBox(b);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const startDrag = (mode: NonNullable<Drag>["mode"]) => (e: React.PointerEvent) => {
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, box };
  };

  const analyze = async () => {
    const img = imgRef.current;
    if (!img || !box) return;
    setBusy(true);
    setPct(0);
    try {
      const sx = box.x * img.naturalWidth, sy = box.y * img.naturalHeight;
      const sw = box.w * img.naturalWidth, sh = box.h * img.naturalHeight;
      const outScale = sw > OUT_MAX ? OUT_MAX / sw : 1;
      const outW = Math.max(1, Math.round(sw * outScale));
      const outH = Math.max(1, Math.round(sh * outScale));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
      const { raw, fields } = await runCartelOcr(blob, setPct);
      if (onResultRaw) onResultRaw(raw);
      else onResult?.(fields);
    } catch {
      // OCR indisponible → on renvoie vide, l'utilisateur saisit à la main.
      if (onResultRaw) onResultRaw("");
      else onResult?.({});
    }
    setBusy(false);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 gap-2">
        <button onClick={onCancel} disabled={busy} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-50 transition-colors flex-shrink-0" aria-label="Annuler">
          <X size={18} strokeWidth={2} />
        </button>
        <p className="text-sm font-medium text-white/90 truncate">{title}</p>
        <button onClick={analyze} disabled={busy || !box} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black text-sm font-medium disabled:opacity-40 transition-opacity flex-shrink-0">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ScanText size={15} strokeWidth={2.5} />}
          {busy ? `Lecture… ${pct}%` : actionLabel}
        </button>
      </div>

      {/* Zoom — agrandir l'image avant de cadrer, utile quand le cartel a été
          photographié de loin et apparaît petit (retour 2026-10-16). */}
      <div className="flex items-center justify-center gap-3 pb-2 flex-shrink-0">
        <button
          onClick={() => changeZoom(-ZOOM_STEP)}
          disabled={busy || zoom <= ZOOM_MIN}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-30 transition-colors"
          aria-label="Dézoomer"
        >
          <ZoomOut size={15} strokeWidth={2} />
        </button>
        <span className="text-[11px] text-white/60 w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => changeZoom(ZOOM_STEP)}
          disabled={busy || zoom >= ZOOM_MAX}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-30 transition-colors"
          aria-label="Zoomer"
        >
          <ZoomIn size={15} strokeWidth={2} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-auto touch-pan-x touch-pan-y">
        <div
          className="relative inline-block leading-none flex-shrink-0"
          style={displaySize && zoom > 1 ? { width: displaySize.w, height: displaySize.h } : undefined}
        >
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={url}
              alt="Cartel à recadrer"
              onLoad={() => { initBox(); measureBase(); }}
              draggable={false}
              className={zoom > 1 ? "block select-none w-full h-full" : "block max-w-full max-h-[72vh] select-none"}
            />
          )}
          {box && (
            <>
              {/* Voile hors du cadre (4 bandes) pour focaliser l'œil */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-0 right-0 top-0 bg-black/55" style={{ height: `${box.y * 100}%` }} />
                <div className="absolute left-0 right-0 bottom-0 bg-black/55" style={{ top: `${(box.y + box.h) * 100}%` }} />
                <div className="absolute left-0 bg-black/55" style={{ top: `${box.y * 100}%`, height: `${box.h * 100}%`, width: `${box.x * 100}%` }} />
                <div className="absolute right-0 bg-black/55" style={{ top: `${box.y * 100}%`, height: `${box.h * 100}%`, left: `${(box.x + box.w) * 100}%` }} />
              </div>
              {/* Cadre déplaçable */}
              <div
                onPointerDown={startDrag("move")}
                className="absolute border-2 border-white/90 cursor-move touch-none"
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
              >
                {(["nw", "ne", "sw", "se"] as const).map((c) => (
                  <span
                    key={c}
                    onPointerDown={startDrag(c)}
                    className="absolute w-6 h-6 bg-white rounded-full border border-black/20 touch-none"
                    style={{
                      left: c.includes("w") ? -12 : undefined,
                      right: c.includes("e") ? -12 : undefined,
                      top: c.includes("n") ? -12 : undefined,
                      bottom: c.includes("s") ? -12 : undefined,
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <p className="flex-shrink-0 text-center text-[11px] text-white/60 pb-[calc(1rem+env(safe-area-inset-bottom))] px-4">
        {hint}
      </p>
    </div>,
    document.body,
  );
}
