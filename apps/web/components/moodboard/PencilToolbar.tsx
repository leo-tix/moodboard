"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { PencilTool } from "./PencilLayer";

// ── Preset palettes ─────────────────────────────────────────────────────────

const COLORS = [
  "#ffffff", // blanc
  "#f0e6d2", // beige chaud
  "#a78bfa", // violet accent
  "#60a5fa", // bleu
  "#34d399", // vert menthe
  "#fbbf24", // ambre
  "#f87171", // rouge corail
  "#000000", // noir
];

const SIZES: { label: string; value: number }[] = [
  { label: "S",  value: 2  },
  { label: "M",  value: 5  },
  { label: "L",  value: 12 },
];

// ── Icons ───────────────────────────────────────────────────────────────────

const PenIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2.5l2.5 2.5L5 13.5 2 14l.5-3L11 2.5z"/>
    <path d="M9.5 4l2.5 2.5"/>
  </svg>
);

const MarkerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 13l2-5L12 3l1 1-7 7-5 2z"/>
    <path d="M9 5l2 2"/>
    <path d="M3 13l1-1"/>
  </svg>
);

const EraserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 14h12"/>
    <path d="M12.5 3.5L14 5 7.5 11.5 4 12 3.5 8.5 10 2l2.5 1.5z"/>
    <path d="M3.5 8.5L7.5 12"/>
  </svg>
);

const UndoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 5h6a3 3 0 0 1 0 6H5"/>
    <path d="M2 5l3-3M2 5l3 3"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3.5h9"/>
    <path d="M5 3.5V2.5h3v1"/>
    <rect x="3" y="3.5" width="7" height="8" rx="1"/>
    <path d="M5.5 6v3.5M7.5 6v3.5"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M1 1l9 9M10 1L1 10"/>
  </svg>
);

// Drag handle: 2×3 grid of dots
const GripIcon = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
    <circle cx="2.5" cy="2.5" r="1.5"/>
    <circle cx="7.5" cy="2.5" r="1.5"/>
    <circle cx="2.5" cy="7"   r="1.5"/>
    <circle cx="7.5" cy="7"   r="1.5"/>
    <circle cx="2.5" cy="11.5" r="1.5"/>
    <circle cx="7.5" cy="11.5" r="1.5"/>
  </svg>
);

// ── Component ───────────────────────────────────────────────────────────────

interface Props {
  tool: PencilTool;
  color: string;
  size: number;
  canUndo: boolean;
  canClear: boolean;
  onToolChange: (t: PencilTool) => void;
  onColorChange: (c: string) => void;
  onSizeChange: (s: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onClose: () => void;
}

export function PencilToolbar({
  tool,
  color,
  size,
  canUndo,
  canClear,
  onToolChange,
  onColorChange,
  onSizeChange,
  onUndo,
  onClear,
  onClose,
}: Props) {
  const [confirmClear, setConfirmClear] = useState(false);

  // ── Draggable position ──────────────────────────────────────────────────────
  // Initial position: left edge, vertically centered (adjusted on mount)
  const [pos, setPos] = useState({ x: 12, y: 200 });
  useEffect(() => {
    setPos({ x: 12, y: Math.max(12, Math.round(window.innerHeight / 2) - 220) });
  }, []);

  const isDragging  = useRef(false);
  const dragStart   = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });

  const onGripPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    dragStart.current  = { mx: e.clientX, my: e.clientY, tx: pos.x, ty: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onGripPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    e.preventDefault();
    e.stopPropagation();
    const newX = Math.max(0, dragStart.current.tx + e.clientX - dragStart.current.mx);
    const newY = Math.max(0, dragStart.current.ty + e.clientY - dragStart.current.my);
    setPos({ x: newX, y: newY });
  }, []);

  const onGripPointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    e.stopPropagation();
  }, []);

  return (
    // Floating palette — positioned via drag state, defaults to left side vertically centered.
    // z-index below ContextualToolbar (200) but above canvas elements.
    // onPointerDown stopPropagation: ensures the Apple Pencil can tap toolbar buttons
    // without the PencilLayer's viewport listener intercepting the event.
    <div
      className="absolute z-[160] flex flex-col items-center gap-1.5
                 bg-[var(--bg-elevated)]/95 backdrop-blur border border-[var(--border-default)]
                 rounded-2xl shadow-2xl px-2 py-2 select-none"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      data-role="pencil-toolbar"
    >
      {/* ── Drag handle ── */}
      <div
        className="w-9 h-6 flex items-center justify-center rounded-xl
                   text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]
                   hover:bg-[var(--bg-surface)] transition-colors cursor-grab active:cursor-grabbing touch-none"
        title="Déplacer la palette"
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerUp}
      >
        <GripIcon />
      </div>

      {/* ── Close drawing mode ── */}
      <button
        onClick={onClose}
        title="Quitter le mode dessin"
        className="w-9 h-9 flex items-center justify-center rounded-xl
                   text-[var(--text-tertiary)] hover:text-[var(--text-primary)]
                   hover:bg-[var(--bg-surface)] transition-colors"
      >
        <CloseIcon />
      </button>

      <div className="w-5 h-px bg-[var(--border-subtle)]" />

      {/* ── Tools ── */}
      {(
        [
          { t: "pen"    as PencilTool, icon: <PenIcon />,    label: "Stylo"    },
          { t: "marker" as PencilTool, icon: <MarkerIcon />, label: "Surligneur" },
          { t: "eraser" as PencilTool, icon: <EraserIcon />, label: "Gomme"    },
        ] as const
      ).map(({ t, icon, label }) => (
        <button
          key={t}
          onClick={() => onToolChange(t)}
          title={label}
          className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors ${
            tool === t
              ? "bg-[var(--accent,#a78bfa)]/20 text-[var(--accent,#a78bfa)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          }`}
        >
          {icon}
        </button>
      ))}

      <div className="w-5 h-px bg-[var(--border-subtle)]" />

      {/* ── Colors ── */}
      <div className="flex flex-col gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            title={c}
            className="w-6 h-6 rounded-full transition-transform hover:scale-110 flex-shrink-0"
            style={{
              backgroundColor: c,
              border: color === c
                ? "2px solid var(--accent, #a78bfa)"
                : c === "#ffffff"
                ? "1.5px solid rgba(255,255,255,0.2)"
                : "1.5px solid transparent",
              boxShadow: color === c ? "0 0 0 1px rgba(0,0,0,0.3)" : undefined,
              outline: c === "#000000" ? "1px solid rgba(255,255,255,0.12)" : undefined,
            }}
          />
        ))}
        {/* Custom color picker */}
        <label
          className="w-6 h-6 rounded-full cursor-pointer flex items-center justify-center
                     bg-[var(--bg-surface)] border border-[var(--border-default)]
                     hover:border-[var(--border-strong)] transition-colors relative overflow-hidden"
          title="Couleur personnalisée"
        >
          <span className="text-[8px] text-[var(--text-tertiary)] font-bold leading-none">+</span>
          <input
            type="color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>
      </div>

      <div className="w-5 h-px bg-[var(--border-subtle)]" />

      {/* ── Size ── */}
      {SIZES.map(({ label, value }) => (
        <button
          key={value}
          onClick={() => onSizeChange(value)}
          title={`Taille ${label}`}
          className={`w-9 h-9 flex items-center justify-center rounded-xl text-[10px] font-medium transition-colors ${
            size === value
              ? "bg-[var(--accent,#a78bfa)]/20 text-[var(--accent,#a78bfa)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          }`}
        >
          {label}
        </button>
      ))}

      <div className="w-5 h-px bg-[var(--border-subtle)]" />

      {/* ── Undo ── */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Annuler le dernier trait"
        className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors
                   text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                   hover:bg-[var(--bg-surface)] disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <UndoIcon />
      </button>

      {/* ── Clear all ── */}
      <div className="relative">
        <button
          onClick={() => canClear && setConfirmClear(true)}
          disabled={!canClear}
          title="Tout effacer"
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors
                     text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10
                     disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <TrashIcon />
        </button>

        {/* Inline confirmation panel — appears to the right of the toolbar */}
        {confirmClear && (
          <div
            className="absolute left-full ml-3 top-1/2 -translate-y-1/2
                       bg-[var(--bg-elevated)] border border-red-500/30 rounded-2xl
                       shadow-2xl p-3 w-52 z-[170]"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2 mb-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5 text-red-400" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2L14.5 13.5H1.5L8 2z"/>
                <path d="M8 6.5v3"/>
                <circle cx="8" cy="11.5" r="0.5" fill="currentColor"/>
              </svg>
              <p className="text-xs text-[var(--text-primary)] leading-relaxed">
                Effacer <strong>tous les dessins</strong> ? Cette action est irréversible.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { onClear(); setConfirmClear(false); }}
                className="flex-1 text-xs py-2 rounded-xl bg-red-500/20 text-red-400
                           hover:bg-red-500/30 active:bg-red-500/40 transition-colors font-medium"
              >
                Effacer
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="flex-1 text-xs py-2 rounded-xl
                           bg-[var(--bg-surface)] text-[var(--text-secondary)]
                           hover:bg-[var(--bg-hover)] active:bg-[var(--border-subtle)]
                           transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
