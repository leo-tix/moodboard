"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getImageUrl } from "@/lib/storage/urls";

interface ImmersiveViewerProps {
  storageKey: string | null;
  title: string;
  counter?: string; // ex: "3 / 24"
  onClose: () => void;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
}

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

// Visionneuse plein écran mobile — gestes continus type Apple Photos / Instagram :
// pinch-zoom fluide autour du point de pincement, pan au doigt une fois zoomé,
// double-tap pour zoomer/dézoomer au point tapé, swipe horizontal = image
// précédente/suivante (à l'échelle 1), swipe vers le bas = fermeture avec
// suivi du doigt, tap simple = afficher/masquer le chrome.
// Le transform est appliqué via ref à chaque frame — aucun re-render React
// pendant le geste (même principe que l'éditeur de planches).
export function ImmersiveViewer({
  storageKey,
  title,
  counter,
  onClose,
  onPrev,
  onNext,
}: ImmersiveViewerProps) {
  const [chromeVisible, setChromeVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // ── État gestuel (refs — jamais de setState pendant un geste) ──
  const t = useRef({ scale: 1, tx: 0, ty: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number; midX: number; midY: number; tx: number; ty: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // Mode du drag 1-doigt à l'échelle 1 : indéterminé → "h" (nav) ou "v" (dismiss)
  const swipeAxis = useRef<"h" | "v" | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const movedRef = useRef(false);

  const apply = (withTransition = false) => {
    const el = imgWrapRef.current;
    if (!el) return;
    el.style.transition = withTransition ? "transform 0.22s cubic-bezier(0.2, 0, 0, 1)" : "none";
    el.style.transform = `translate(${t.current.tx}px, ${t.current.ty}px) scale(${t.current.scale})`;
  };

  const setBackdropDim = (opacity: number, withTransition = false) => {
    const el = backdropRef.current;
    if (!el) return;
    el.style.transition = withTransition ? "opacity 0.22s ease" : "none";
    el.style.opacity = String(opacity);
  };

  const clampPan = () => {
    const c = containerRef.current;
    if (!c) return;
    const maxX = ((t.current.scale - 1) * c.clientWidth) / 2;
    const maxY = ((t.current.scale - 1) * c.clientHeight) / 2;
    t.current.tx = Math.max(-maxX, Math.min(maxX, t.current.tx));
    t.current.ty = Math.max(-maxY, Math.min(maxY, t.current.ty));
  };

  const resetTransform = (withTransition = true) => {
    t.current = { scale: 1, tx: 0, ty: 0 };
    apply(withTransition);
    setBackdropDim(1, withTransition);
  };

  // ── Verrouiller le scroll du body ──
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Échap pour fermer (clavier externe / desktop de secours) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext]);

  // Reset au changement d'image
  useEffect(() => {
    resetTransform(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // ── Gestes (pointer events) ──
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;

    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      pinchStart.current = {
        dist,
        scale: t.current.scale,
        midX: (p1.x + p2.x) / 2,
        midY: (p1.y + p2.y) / 2,
        tx: t.current.tx,
        ty: t.current.ty,
      };
      dragStart.current = null;
      swipeAxis.current = null;
    } else if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, tx: t.current.tx, ty: t.current.ty };
      swipeAxis.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // ── Pinch (2 doigts) ──
    if (pointers.current.size === 2 && pinchStart.current) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const ps = pinchStart.current;
      const c = containerRef.current;
      if (!c) return;
      const cx = c.clientWidth / 2;
      const cy = c.clientHeight / 2;

      const newScale = Math.min(MAX_SCALE, Math.max(0.6, ps.scale * (dist / ps.dist)));
      // Garder le point du canvas situé sous le milieu du pincement
      const canvasX = (ps.midX - cx - ps.tx) / ps.scale;
      const canvasY = (ps.midY - cy - ps.ty) / ps.scale;
      t.current.scale = newScale;
      t.current.tx = midX - cx - canvasX * newScale;
      t.current.ty = midY - cy - canvasY * newScale;
      if (newScale > 1) clampPan();
      movedRef.current = true;
      apply();
      return;
    }

    // ── Drag (1 doigt) ──
    if (pointers.current.size === 1 && dragStart.current) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) movedRef.current = true;

      if (t.current.scale > 1.02) {
        // Pan de l'image zoomée
        t.current.tx = dragStart.current.tx + dx;
        t.current.ty = dragStart.current.ty + dy;
        clampPan();
        apply();
        return;
      }

      // À l'échelle 1 : déterminer l'axe une fois le seuil franchi
      if (!swipeAxis.current && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
        swipeAxis.current = Math.abs(dy) > Math.abs(dx) ? "v" : "h";
      }

      if (swipeAxis.current === "v" && dy > 0) {
        // Dismiss : l'image suit le doigt, le fond s'éclaircit (pattern Instagram)
        t.current.ty = dy;
        t.current.scale = Math.max(0.85, 1 - dy / 1200);
        apply();
        setBackdropDim(Math.max(0.3, 1 - dy / 500));
      } else if (swipeAxis.current === "h") {
        // Feedback visuel du swipe de navigation
        t.current.tx = dx;
        apply();
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasPinching = pointers.current.size === 2;
    pointers.current.delete(e.pointerId);

    if (wasPinching) {
      pinchStart.current = null;
      // Zoom arrière sous 1 → snap back à 1 centré
      if (t.current.scale <= 1.02) resetTransform();
      // Le doigt restant repart d'un drag propre
      const rest = [...pointers.current.values()][0];
      if (rest) dragStart.current = { x: rest.x, y: rest.y, tx: t.current.tx, ty: t.current.ty };
      return;
    }

    if (pointers.current.size > 0) return;

    const ds = dragStart.current;
    dragStart.current = null;
    const axis = swipeAxis.current;
    swipeAxis.current = null;

    // ── Tap / double-tap (pas de mouvement) ──
    if (!movedRef.current) {
      const now = Date.now();
      const last = lastTap.current;
      if (last && now - last.time < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        // Double-tap : zoom au point tapé ↔ reset
        lastTap.current = null;
        const c = containerRef.current;
        if (!c) return;
        if (t.current.scale > 1.02) {
          resetTransform();
        } else {
          const cx = c.clientWidth / 2;
          const cy = c.clientHeight / 2;
          const canvasX = (e.clientX - cx - t.current.tx) / t.current.scale;
          const canvasY = (e.clientY - cy - t.current.ty) / t.current.scale;
          t.current.scale = DOUBLE_TAP_SCALE;
          t.current.tx = e.clientX - cx - canvasX * DOUBLE_TAP_SCALE;
          t.current.ty = e.clientY - cy - canvasY * DOUBLE_TAP_SCALE;
          clampPan();
          apply(true);
        }
      } else {
        lastTap.current = { time: now, x: e.clientX, y: e.clientY };
        // Tap simple : bascule le chrome (léger délai pour laisser sa chance au double-tap)
        setTimeout(() => {
          if (lastTap.current && Date.now() - lastTap.current.time >= 280) {
            setChromeVisible((v) => !v);
          }
        }, 300);
      }
      return;
    }

    if (!ds || t.current.scale > 1.02) return;

    const dx = e.clientX - ds.x;
    const dy = e.clientY - ds.y;

    if (axis === "v" && dy > 110) {
      onClose();
      return;
    }
    if (axis === "h" && Math.abs(dx) > 70) {
      if (dx < 0 && onNext) { onNext(); return; }
      if (dx > 0 && onPrev) { onPrev(); return; }
    }
    // Pas de déclenchement → retour élastique
    resetTransform();
  };

  const url = storageKey ? getImageUrl(storageKey) : null;

  const content = (
    <div className="fixed inset-0 z-[200] select-none">
      {/* Fond noir — opacité pilotée pendant le swipe-down */}
      <div ref={backdropRef} className="absolute inset-0 bg-black" />

      {/* Zone gestuelle */}
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={imgWrapRef} className="w-full h-full will-change-transform">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={title}
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white/30 text-sm">Pas d&apos;image</span>
            </div>
          )}
        </div>
      </div>

      {/* Chrome — top bar */}
      <div
        className={`absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-200 ${
          chromeVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center gap-2 px-2 py-1.5">
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center text-white/80 active:text-white text-lg flex-shrink-0"
            aria-label="Fermer"
          >
            ✕
          </button>
          <p className="flex-1 min-w-0 text-white/90 text-sm font-light truncate">{title}</p>
          {counter && (
            <span className="text-white/40 text-xs tabular-nums flex-shrink-0 pr-3">{counter}</span>
          )}
        </div>
      </div>

      {/* Hint bas — geste de fermeture */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 flex justify-center pb-3 pointer-events-none transition-opacity duration-200 ${
          chromeVisible ? "opacity-100" : "opacity-0"
        }`}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
      >
        <div className="w-9 h-1 rounded-full bg-white/25" />
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(content, document.body);
}
