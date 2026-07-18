"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Undo2, Trash2, Pen, Highlighter, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { drawStroke, drawStrokeLive } from "@/lib/moodboard/pencil";
import type { Stroke, StrokePoint, PencilTool } from "@/lib/moodboard/types";

// Bloc-notes de croquis à main levée pour le carnet de visite (Phase 8).
// RÉUTILISE le moteur de brosse des planches (lib/moodboard/pencil.ts) pour un
// rendu identique, mais en composant AUTONOME : pas de pan/zoom, et accepte
// TOUS les pointeurs (doigt / souris / stylet), pas seulement l'Apple Pencil.
// Le système Pencil des planches (PencilLayer) n'est pas modifié.

const PAPER = "#f7f5ef";
const COLORS = ["#1f1b16", "#c0392b", "#2c6e9b", "#27795b", "#b8860b", "#7d3c98", "#ffffff"];
const WIDTHS = [2, 4, 8];
const EXPORT_SCALE = 2;

function makeId() { return Math.random().toString(36).slice(2, 9); }

export function SketchPad({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (blob: Blob) => void;
  saving?: boolean;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const rafRef = useRef<number | null>(null);

  const [tool, setTool] = useState<PencilTool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [hasStrokes, setHasStrokes] = useState(false);
  const toolRef = useRef(tool); toolRef.current = tool;
  const colorRef = useRef(color); colorRef.current = color;
  const widthRef = useRef(width); widthRef.current = width;

  const sizeCanvases = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const { width: w, height: h } = area.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    for (const c of [committedRef.current, liveRef.current]) {
      if (!c) continue;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
  }, []);

  const redrawCommitted = useCallback(() => {
    const c = committedRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of strokesRef.current) drawStroke(ctx, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  const redrawLive = useCallback(() => {
    rafRef.current = null;
    const c = liveRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!currentRef.current) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokeLive(ctx, currentRef.current);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  // Init + resize
  useEffect(() => {
    if (!open) return;
    sizeCanvases();
    redrawCommitted();
    const ro = new ResizeObserver(() => { sizeCanvases(); redrawCommitted(); });
    if (areaRef.current) ro.observe(areaRef.current);
    return () => ro.disconnect();
  }, [open, sizeCanvases, redrawCommitted]);

  // Reset when (re)opened
  useEffect(() => {
    if (open) {
      strokesRef.current = [];
      currentRef.current = null;
      setHasStrokes(false);
      // clear on next frame once canvases are sized
      requestAnimationFrame(() => { redrawCommitted(); redrawLive(); });
    }
  }, [open, redrawCommitted, redrawLive]);

  // Pointer handlers on the live canvas
  useEffect(() => {
    const c = liveRef.current;
    if (!c || !open) return;

    const toXY = (e: PointerEvent): StrokePoint => {
      const rect = c.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
      };
    };

    const down = (e: PointerEvent) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      currentRef.current = { id: makeId(), tool: toolRef.current, color: colorRef.current, width: widthRef.current, points: [toXY(e)] };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(redrawLive);
    };
    const move = (e: PointerEvent) => {
      if (!currentRef.current) return;
      e.preventDefault();
      const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evts) currentRef.current.points.push(toXY(ev));
      if (!rafRef.current) rafRef.current = requestAnimationFrame(redrawLive);
    };
    const up = (e: PointerEvent) => {
      const s = currentRef.current;
      currentRef.current = null;
      const lc = liveRef.current;
      if (lc) { const lx = lc.getContext("2d"); lx?.setTransform(1,0,0,1,0,0); lx?.clearRect(0,0,lc.width,lc.height); }
      if (s && s.points.length > 0) {
        strokesRef.current = [...strokesRef.current, s];
        setHasStrokes(true);
        redrawCommitted();
      }
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    c.addEventListener("pointerdown", down, { passive: false });
    c.addEventListener("pointermove", move, { passive: false });
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    };
  }, [open, redrawLive, redrawCommitted]);

  const undo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setHasStrokes(strokesRef.current.length > 0);
    redrawCommitted();
  };
  const clearAll = () => {
    strokesRef.current = [];
    setHasStrokes(false);
    redrawCommitted();
  };

  const save = () => {
    const area = areaRef.current;
    if (!area) return;
    const { width: w, height: h } = area.getBoundingClientRect();
    const ex = document.createElement("canvas");
    ex.width = Math.round(w * EXPORT_SCALE);
    ex.height = Math.round(h * EXPORT_SCALE);
    const ctx = ex.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, ex.width, ex.height);
    ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, 0, 0);
    for (const s of strokesRef.current) drawStroke(ctx, s);
    ex.toBlob((blob) => { if (blob) onSave(blob); }, "image/png");
  };

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex flex-col">
      {/* Barre du haut */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 transition-colors" aria-label="Fermer">
          <X size={18} strokeWidth={2} />
        </button>
        <p className="text-sm font-medium text-white/90">Croquis</p>
        <button onClick={save} disabled={!hasStrokes || saving} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black text-sm font-medium disabled:opacity-40 transition-opacity">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} strokeWidth={2.5} />}
          {saving ? "…" : "OK"}
        </button>
      </div>

      {/* Zone de dessin (papier) */}
      <div className="flex-1 min-h-0 px-4 pb-3 flex items-center justify-center">
        <div ref={areaRef} className="relative w-full h-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl" style={{ backgroundColor: PAPER, aspectRatio: "auto" }}>
          <canvas ref={committedRef} className="absolute inset-0" style={{ touchAction: "none" }} />
          <canvas ref={liveRef} className="absolute inset-0" style={{ touchAction: "none" }} />
        </div>
      </div>

      {/* Barre d'outils */}
      <div className="flex-shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1 flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={cn("w-7 h-7 rounded-full border-2 transition-transform", color === c ? "border-white scale-110" : "border-white/20")} style={{ backgroundColor: c }} aria-label={`Couleur ${c}`} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white/10 rounded-full p-1">
            <button onClick={() => setTool("pen")} className={cn("w-8 h-8 flex items-center justify-center rounded-full transition-colors", tool === "pen" ? "bg-white text-black" : "text-white/80")} aria-label="Stylo"><Pen size={15} strokeWidth={2} /></button>
            <button onClick={() => setTool("marker")} className={cn("w-8 h-8 flex items-center justify-center rounded-full transition-colors", tool === "marker" ? "bg-white text-black" : "text-white/80")} aria-label="Marqueur"><Highlighter size={15} strokeWidth={2} /></button>
          </div>
          <div className="flex items-center gap-1 bg-white/10 rounded-full p-1">
            {WIDTHS.map((wd) => (
              <button key={wd} onClick={() => setWidth(wd)} className={cn("w-8 h-8 flex items-center justify-center rounded-full transition-colors", width === wd ? "bg-white" : "")} aria-label={`Épaisseur ${wd}`}>
                <span className="rounded-full" style={{ width: wd + 3, height: wd + 3, backgroundColor: width === wd ? "#000" : "#fff" }} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-white/10 rounded-full p-1">
            <button onClick={undo} disabled={!hasStrokes} className="w-8 h-8 flex items-center justify-center rounded-full text-white/80 disabled:opacity-30" aria-label="Annuler"><Undo2 size={15} strokeWidth={2} /></button>
            <button onClick={clearAll} disabled={!hasStrokes} className="w-8 h-8 flex items-center justify-center rounded-full text-white/80 disabled:opacity-30" aria-label="Tout effacer"><Trash2 size={15} strokeWidth={2} /></button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
