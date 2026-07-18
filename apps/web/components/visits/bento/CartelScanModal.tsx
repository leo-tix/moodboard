"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ScanText, Loader2 } from "lucide-react";
import { runCartelOcr, type CartelFields } from "@/lib/visits/cartelOcr";

// Recadrage AVANT OCR (retour utilisateur 2026-07-19) : l'utilisateur cadre la
// zone du cartel pour que Tesseract se concentre dessus (moins de bruit = bien
// meilleure lecture). La photo n'est PAS stockée : elle sert uniquement à l'OCR
// puis est jetée (le module cartel n'affiche pas d'image).

interface Box { x: number; y: number; w: number; h: number }
type Drag = { mode: "move" | "nw" | "ne" | "sw" | "se"; startX: number; startY: number; box: Box } | null;
const MIN = 40;
const OUT_MAX = 1600; // largeur max du recadrage envoyé à l'OCR

export function CartelScanModal({
  file,
  onCancel,
  onResult,
}: {
  file: File;
  onCancel: () => void;
  onResult: (fields: CartelFields) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const dragRef = useRef<Drag>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const initBox = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.clientWidth, h = img.clientHeight;
    setBox({ x: w * 0.06, y: h * 0.06, w: w * 0.88, h: h * 0.88 });
  }, []);

  // Recalage du cadre si le conteneur change de taille (rotation).
  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(() => initBox());
    if (imgRef.current) ro.observe(imgRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

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
        // Redimensionnement par coin — on borne pour rester dans l'image + taille mini.
        let { x, y, w, h } = d.box;
        if (d.mode.includes("w")) { const nx = Math.max(0, Math.min(x + w - MIN, x + dx)); w += x - nx; x = nx; }
        if (d.mode.includes("e")) { w = Math.max(MIN, Math.min(maxW - x, w + dx)); }
        if (d.mode.includes("n")) { const ny = Math.max(0, Math.min(y + h - MIN, y + dy)); h += y - ny; y = ny; }
        if (d.mode.includes("s")) { h = Math.max(MIN, Math.min(maxH - y, h + dy)); }
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
      const scaleX = img.naturalWidth / img.clientWidth;
      const scaleY = img.naturalHeight / img.clientHeight;
      const sw = box.w * scaleX, sh = box.h * scaleY;
      const outScale = sw > OUT_MAX ? OUT_MAX / sw : 1;
      const outW = Math.max(1, Math.round(sw * outScale));
      const outH = Math.max(1, Math.round(sh * outScale));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.drawImage(img, box.x * scaleX, box.y * scaleY, sw, sh, 0, 0, outW, outH);
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
      const { fields } = await runCartelOcr(blob, setPct);
      onResult(fields);
    } catch {
      // OCR indisponible → on renvoie vide, l'utilisateur saisit à la main.
      onResult({});
    }
    setBusy(false);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button onClick={onCancel} disabled={busy} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-50 transition-colors" aria-label="Annuler">
          <X size={18} strokeWidth={2} />
        </button>
        <p className="text-sm font-medium text-white/90">Recadrer le cartel</p>
        <button onClick={analyze} disabled={busy || !box} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black text-sm font-medium disabled:opacity-40 transition-opacity">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ScanText size={15} strokeWidth={2.5} />}
          {busy ? `Lecture… ${pct}%` : "Analyser"}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <div ref={wrapRef} className="relative inline-block leading-none">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={url}
              alt="Cartel à recadrer"
              onLoad={initBox}
              draggable={false}
              className="block max-w-full max-h-[72vh] select-none"
            />
          )}
          {box && (
            <>
              {/* Voile hors du cadre (4 bandes) pour focaliser l'œil */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-0 right-0 top-0 bg-black/55" style={{ height: box.y }} />
                <div className="absolute left-0 right-0 bottom-0 bg-black/55" style={{ top: box.y + box.h }} />
                <div className="absolute left-0 bg-black/55" style={{ top: box.y, height: box.h, width: box.x }} />
                <div className="absolute right-0 bg-black/55" style={{ top: box.y, height: box.h, left: box.x + box.w }} />
              </div>
              {/* Cadre déplaçable */}
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

      <p className="flex-shrink-0 text-center text-[11px] text-white/60 pb-[calc(1rem+env(safe-area-inset-bottom))] px-4">
        Cadre la zone du cartel puis « Analyser » — la photo n&apos;est pas conservée.
      </p>
    </div>,
    document.body,
  );
}
