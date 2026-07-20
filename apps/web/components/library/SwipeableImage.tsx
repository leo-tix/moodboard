"use client";

import { useEffect, useRef } from "react";
import { getImageUrl, getThumbnailUrl } from "@/lib/storage/urls";

// Image de la page détail (mobile) avec VRAI glissement gauche/droite façon
// Apple Photos : piste de 3 diapos (précédente / courante / suivante). Le doigt
// fait glisser la piste ; au relâché au-delà du seuil on navigue (onPrev/onNext),
// sinon retour élastique. Un tap (sans mouvement) ouvre le plein écran (onTap).
// Vertical = laissé au scroll natif de la fiche (touch-action: pan-y).
const TRACK_CENTER = -100 / 3;
const NAV_THRESHOLD = 60;

export function SwipeableImage({
  storageKey,
  currentThumbKey,
  prevThumbKey,
  nextThumbKey,
  alt,
  onPrev,
  onNext,
  onTap,
  fill = false,
}: {
  storageKey: string | null;
  currentThumbKey: string | null;
  prevThumbKey: string | null;
  nextThumbKey: string | null;
  alt: string;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onTap: () => void;
  /** true = remplit le conteneur parent (h-full) au lieu de la boîte fixe 62vh
   *  (utilisé pour donner le glissement à l'iPad dans la zone image du split). */
  fill?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"h" | "v" | null>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const navigating = useRef(false);

  const applyTrack = (dx: number, withT = false) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = withT ? "transform 0.25s cubic-bezier(0.2,0,0,1)" : "none";
    el.style.transform = `translateX(calc(${TRACK_CENTER}% + ${dx}px))`;
  };

  // Recentre (sans transition) quand l'image change.
  useEffect(() => {
    applyTrack(0, false);
    navigating.current = false;
  }, [storageKey]);

  const onDown = (e: React.PointerEvent) => {
    if (navigating.current) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    axis.current = null;
    dragging.current = true;
    moved.current = false;
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved.current = true;
    if (!axis.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (axis.current === "h") {
      let d = dx;
      if ((dx > 0 && !onPrev) || (dx < 0 && !onNext)) d = dx * 0.3; // résistance en bout de série
      applyTrack(d);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (!moved.current) { onTap(); return; }
    if (axis.current !== "h") return;
    const dx = e.clientX - startX.current;
    const w = trackRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    if (dx < -NAV_THRESHOLD && onNext) {
      navigating.current = true;
      applyTrack(-w, true);
      setTimeout(onNext, 190);
    } else if (dx > NAV_THRESHOLD && onPrev) {
      navigating.current = true;
      applyTrack(w, true);
      setTimeout(onPrev, 190);
    } else {
      applyTrack(0, true);
    }
  };

  const slideCls = "flex-shrink-0 h-full flex items-center justify-center";
  const imgCls = "max-w-full max-h-full object-contain";

  return (
    <div
      className={fill
        ? "absolute inset-0 overflow-hidden select-none"        // remplit la zone image (parent `relative`) — iPad
        : "relative w-full overflow-hidden select-none"}        // boîte 62vh — mobile
      style={fill ? { touchAction: "pan-y" } : { height: "62vh", touchAction: "pan-y" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div ref={trackRef} className="absolute inset-0 flex h-full will-change-transform" style={{ width: "300%", transform: `translateX(${TRACK_CENTER}%)` }}>
        {/* Précédente (vignette) */}
        <div className={slideCls} style={{ width: "33.3333%" }}>
          {prevThumbKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getThumbnailUrl(prevThumbKey)} alt="" aria-hidden draggable={false} className={imgCls} />
          )}
        </div>
        {/* Courante (vignette placeholder + plein format) */}
        <div className={slideCls} style={{ width: "33.3333%", position: "relative" }}>
          {currentThumbKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getThumbnailUrl(currentThumbKey)} alt="" aria-hidden draggable={false} className={`absolute ${imgCls}`} />
          )}
          {storageKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getImageUrl(storageKey)} alt={alt} draggable={false} className={`relative ${imgCls}`} />
          ) : (
            <span className="text-[var(--text-tertiary)] text-sm">Pas d&apos;image</span>
          )}
        </div>
        {/* Suivante (vignette) */}
        <div className={slideCls} style={{ width: "33.3333%" }}>
          {nextThumbKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getThumbnailUrl(nextThumbKey)} alt="" aria-hidden draggable={false} className={imgCls} />
          )}
        </div>
      </div>
    </div>
  );
}
