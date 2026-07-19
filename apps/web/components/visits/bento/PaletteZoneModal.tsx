"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Check } from "lucide-react";
import { extractPalette } from "@/lib/visits/colorExtract";

// Choix d'une ZONE avant extraction de la palette (retour utilisateur
// 2026-07-19 : « l'extraction n'est pas toujours bonne, définir une zone »).
// Même mécanique de cadre déplaçable/redimensionnable que CartelScanModal, mais
// on extrait les couleurs de la zone (aperçu live) au lieu de faire un OCR.

interface Box { x: number; y: number; w: number; h: number }
type Drag = { mode: "move" | "nw" | "ne" | "sw" | "se"; startX: number; startY: number; box: Box } | null;
const MIN = 40;
const OUT_MAX = 400; // la palette se contente d'une petite résolution

export function PaletteZoneModal({
  file,
  onCancel,
  onResult,
}: {
  file: File;
  onCancel: () => void;
  onResult: (colors: string[]) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const dragRef = useRef<Drag>(null);
  const latestBox = useRef<Box | null>(null);
  const [colors, setColors] = useState<string[]>([]);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const cropBlob = useCallback(async (b: Box): Promise<Blob | null> => {
    const img = imgRef.current;
    if (!img) return null;
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const sw = b.w * scaleX, sh = b.h * scaleY;
    const outScale = sw > OUT_MAX ? OUT_MAX / sw : 1;
    const outW = Math.max(1, Math.round(sw * outScale));
    const outH = Math.max(1, Math.round(sh * outScale));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, b.x * scaleX, b.y * scaleY, sw, sh, 0, 0, outW, outH);
    return new Promise((res) => canvas.toBlob((bl) => res(bl), "image/png"));
  }, []);

  const refreshPreview = useCallback(async (b: Box) => {
    const blob = await cropBlob(b);
    if (!blob) return;
    try {
      const cols = await extractPalette(blob, 6);
      if (cols.length) setColors(cols);
    } catch { /* ignore */ }
  }, [cropBlob]);
  const refreshRef = useRef(refreshPreview);
  refreshRef.current = refreshPreview;

  const initBox = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const b = { x: img.clientWidth * 0.15, y: img.clientHeight * 0.15, w: img.clientWidth * 0.7, h: img.clientHeight * 0.7 };
    latestBox.current = b;
    setBox(b);
    refreshRef.current(b);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const img = imgRef.current;
      if (!d || !img) return;
      e.preventDefault();
      const maxW = img.clientWidth, maxH = img.clientHeight;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      const b = { ...d.box };
      if (d.mode === "move") {
        b.x = Math.max(0, Math.min(maxW - b.w, d.box.x + dx));
        b.y = Math.max(0, Math.min(maxH - b.h, d.box.y + dy));
      } else {
        let { x, y, w, h } = d.box;
        if (d.mode.includes("w")) { const nx = Math.max(0, Math.min(x + w - MIN, x + dx)); w += x - nx; x = nx; }
        if (d.mode.includes("e")) { w = Math.max(MIN, Math.min(maxW - x, w + dx)); }
        if (d.mode.includes("n")) { const ny = Math.max(0, Math.min(y + h - MIN, y + dy)); h += y - ny; y = ny; }
        if (d.mode.includes("s")) { h = Math.max(MIN, Math.min(maxH - y, h + dy)); }
        b.x = x; b.y = y; b.w = w; b.h = h;
      }
      latestBox.current = b;
      setBox(b);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      if (latestBox.current) refreshRef.current(latestBox.current);
    };
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button onClick={onCancel} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 transition-colors" aria-label="Annuler">
          <X size={18} strokeWidth={2} />
        </button>
        <p className="text-sm font-medium text-white/90">Choisir la zone</p>
        <button onClick={() => colors.length && onResult(colors)} disabled={!colors.length} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black text-sm font-medium disabled:opacity-40 transition-opacity">
          <Check size={15} strokeWidth={2.5} /> Extraire
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <div className="relative inline-block leading-none">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={url}
              alt="Image source"
              onLoad={initBox}
              draggable={false}
              className="block max-w-full max-h-[64vh] select-none"
            />
          )}
          {box && (
            <>
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-0 right-0 top-0 bg-black/55" style={{ height: box.y }} />
                <div className="absolute left-0 right-0 bottom-0 bg-black/55" style={{ top: box.y + box.h }} />
                <div className="absolute left-0 bg-black/55" style={{ top: box.y, height: box.h, width: box.x }} />
                <div className="absolute right-0 bg-black/55" style={{ top: box.y, height: box.h, left: box.x + box.w }} />
              </div>
              <div
                onPointerDown={startDrag("move")}
                className="absolute border-2 border-white/90 cursor-move touch-none"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
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

      {/* Aperçu live de la palette de la zone. */}
      <div className="flex-shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))] px-4 space-y-2">
        {colors.length > 0 && (
          <div className="flex items-center justify-center gap-1.5">
            {colors.map((c, i) => (
              <span key={i} className="w-9 h-9 rounded-lg border border-white/15" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        )}
        <p className="text-center text-[11px] text-white/60">Déplace le cadre : la palette se met à jour.</p>
      </div>
    </div>,
    document.body,
  );
}
