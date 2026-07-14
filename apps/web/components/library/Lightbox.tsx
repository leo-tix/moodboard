"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { getImageUrl } from "@/lib/storage/urls";

export interface LightboxItem {
  id: string;
  title: string;
  storageKey: string | null;
  year: number | null;
  category: string | null;
}

interface LightboxProps {
  items: LightboxItem[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function Lightbox({ items, currentIndex, onClose, onNavigate }: LightboxProps) {
  const item = items[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;
  const touchStartX = useRef<number | null>(null);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(currentIndex - 1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(currentIndex + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIndex, hasPrev, hasNext, onClose, onNavigate]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 50) return;
    if (delta > 0 && hasPrev) onNavigate(currentIndex - 1);
    if (delta < 0 && hasNext) onNavigate(currentIndex + 1);
  };

  const imageUrl = item.storageKey ? getImageUrl(item.storageKey) : null;

  const content = (
    <motion.div
      className="fixed inset-0 z-[100] bg-black flex flex-col select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 z-10 bg-gradient-to-b from-black/60 to-transparent absolute inset-x-0 top-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-white/90 text-sm font-light truncate">{item.title}</p>
          {item.year && <span className="text-white/35 text-xs flex-shrink-0">{item.year}</span>}
          {item.category && (
            <span className="text-white/35 text-xs flex-shrink-0 hidden sm:inline">{item.category}</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <span className="text-white/25 text-xs hidden sm:block tabular-nums">
            {currentIndex + 1} / {items.length}
          </span>
          <Link
            href={`/library/${item.id}`}
            onClick={onClose}
            className="text-[11px] text-white/50 hover:text-white/90 transition-colors px-2.5 py-1 border border-white/15 rounded hover:border-white/35"
          >
            Détails →
          </Link>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white transition-colors rounded-full hover:bg-white/10 leading-none"
            aria-label="Fermer"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ── Image area ── */}
      <div
        className="flex-1 relative flex items-center justify-center min-h-0"
        onClick={onClose} // click backdrop = close
      >
        {/* Image container — stops propagation so clicking image doesn't close */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={item.id}
            className="relative w-full h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={(e) => e.stopPropagation()}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={item.title}
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <span className="text-white/25 text-sm">Aucune image</span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* ── Prev arrow ── */}
        {hasPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex - 1); }}
            className="absolute left-2 md:left-5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/50 hover:text-white transition-colors rounded-full hover:bg-white/10 z-10"
            aria-label="Précédent"
          >
            <ChevronLeft size={22} strokeWidth={2} />
          </button>
        )}

        {/* ── Next arrow ── */}
        {hasNext && (
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex + 1); }}
            className="absolute right-2 md:right-5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/50 hover:text-white transition-colors rounded-full hover:bg-white/10 z-10"
            aria-label="Suivant"
          >
            <ChevronRight size={22} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* ── Bottom metadata bar ── */}
      <div className="flex-shrink-0 absolute inset-x-0 bottom-0 px-4 py-3 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
        <div className="flex items-center justify-center">
          {/* Dot indicators — desktop only, max 12 dots */}
          {items.length <= 24 && (
            <div className="flex items-center gap-1">
              {items.map((_, i) => (
                <button
                  key={i}
                  className="pointer-events-auto"
                  onClick={(e) => { e.stopPropagation(); onNavigate(i); }}
                  aria-label={`Image ${i + 1}`}
                >
                  <span
                    className={`block rounded-full transition-all ${
                      i === currentIndex
                        ? "w-3 h-1.5 bg-white"
                        : "w-1.5 h-1.5 bg-white/30 hover:bg-white/60"
                    }`}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(content, document.body);
}
