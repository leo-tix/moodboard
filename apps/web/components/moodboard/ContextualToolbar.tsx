"use client";

import { useState } from "react";
import type {
  CanvasElement,
  ImageElement,
  TextElement,
  ColorElement,
  StickyElement,
} from "@/lib/moodboard/types";

interface Patch {
  [key: string]: unknown;
}

interface Props {
  elements: CanvasElement[];
  selectedIds: string[];
  onUpdateMany: (updates: Array<{ id: string; patch: Patch }>) => void;
  onDeleteSelected: () => void;
  /** Center-X of selection in viewport coordinates */
  posX: number;
  /** Top-Y of selection in viewport coordinates (toolbar renders above) */
  posY: number;
}

// ── Primitives ──────────────────────────────────────────────────────────────

function ToolBtn({
  title,
  onClick,
  children,
  active,
  danger,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`min-w-[22px] h-[22px] px-1 text-[11px] rounded transition-colors flex items-center justify-center gap-0.5 ${
        active
          ? "bg-[var(--accent,#a78bfa)]/20 text-[var(--accent,#a78bfa)]"
          : danger
          ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-3 bg-[var(--border-subtle)] mx-0.5 flex-shrink-0" />;
}

function ColorSwatch({
  value,
  onChange,
  title,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  title: string;
  label?: string;
}) {
  return (
    <label className="relative cursor-pointer flex items-center" title={title}>
      <div
        className="w-5 h-5 rounded border border-[var(--border-default)] flex items-center justify-center text-[8px] font-bold overflow-hidden"
        style={{ backgroundColor: value }}
      >
        {label && <span style={{ color: value === "#ffffff" ? "#000" : "#fff", mixBlendMode: "difference" }}>{label}</span>}
      </div>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        onMouseDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}

function OpacitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        title="Opacité"
        onClick={() => setOpen((v) => !v)}
        className="h-[22px] px-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded transition-colors"
      >
        {Math.round(value * 100)}%
      </button>
      {open && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl p-3 flex flex-col items-center gap-1.5"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="text-[10px] text-[var(--text-tertiary)]">{Math.round(value * 100)}%</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-24 accent-[var(--accent,#a78bfa)]"
          />
        </div>
      )}
    </div>
  );
}

// ── Alignment SVG icons ──────────────────────────────────────────────────────

const AlignIcons = {
  left: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="0" y="1" width="1.5" height="10" />
      <rect x="2" y="2.5" width="5" height="2.5" rx="0.5" />
      <rect x="2" y="7" width="8" height="2.5" rx="0.5" />
    </svg>
  ),
  centerH: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="5.25" y="0" width="1.5" height="12" />
      <rect x="2" y="2.5" width="8" height="2.5" rx="0.5" />
      <rect x="1" y="7" width="10" height="2.5" rx="0.5" />
    </svg>
  ),
  right: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="10.5" y="1" width="1.5" height="10" />
      <rect x="5" y="2.5" width="5" height="2.5" rx="0.5" />
      <rect x="2" y="7" width="8" height="2.5" rx="0.5" />
    </svg>
  ),
  top: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="1" y="0" width="10" height="1.5" />
      <rect x="2.5" y="2" width="2.5" height="5" rx="0.5" />
      <rect x="7" y="2" width="2.5" height="8" rx="0.5" />
    </svg>
  ),
  centerV: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="0" y="5.25" width="12" height="1.5" />
      <rect x="2.5" y="2" width="2.5" height="8" rx="0.5" />
      <rect x="7" y="1" width="2.5" height="10" rx="0.5" />
    </svg>
  ),
  bottom: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="1" y="10.5" width="10" height="1.5" />
      <rect x="2.5" y="4" width="2.5" height="6" rx="0.5" />
      <rect x="7" y="1" width="2.5" height="9" rx="0.5" />
    </svg>
  ),
};

// ── Main toolbar ─────────────────────────────────────────────────────────────

export function ContextualToolbar({
  elements,
  selectedIds,
  onUpdateMany,
  onDeleteSelected,
  posX,
  posY,
}: Props) {
  const selected = elements.filter((el) => selectedIds.includes(el.id));
  if (selected.length === 0) return null;

  const isMulti = selected.length > 1;
  const single = !isMulti ? selected[0] : null;

  const upd = (id: string, patch: Patch) => onUpdateMany([{ id, patch }]);

  const align = (type: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") => {
    const minX = Math.min(...selected.map((el) => el.x));
    const minY = Math.min(...selected.map((el) => el.y));
    const maxX = Math.max(...selected.map((el) => el.x + el.w));
    const maxY = Math.max(...selected.map((el) => el.y + el.h));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    onUpdateMany(
      selected.map((el) => {
        let patch: Patch = {};
        if (type === "left") patch = { x: minX };
        else if (type === "centerH") patch = { x: cx - el.w / 2 };
        else if (type === "right") patch = { x: maxX - el.w };
        else if (type === "top") patch = { y: minY };
        else if (type === "centerV") patch = { y: cy - el.h / 2 };
        else if (type === "bottom") patch = { y: maxY - el.h };
        return { id: el.id, patch };
      })
    );
  };

  return (
    <div
      className="absolute z-[200] flex items-center gap-0.5 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl px-1.5 py-1"
      style={{
        left: posX,
        top: Math.max(4, posY - 42),
        transform: "translateX(-50%)",
        pointerEvents: "all",
        whiteSpace: "nowrap",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ── Multi-select: alignment ── */}
      {isMulti && (
        <>
          <ToolBtn title="Aligner à gauche" onClick={() => align("left")}>{AlignIcons.left}</ToolBtn>
          <ToolBtn title="Centrer horizontalement" onClick={() => align("centerH")}>{AlignIcons.centerH}</ToolBtn>
          <ToolBtn title="Aligner à droite" onClick={() => align("right")}>{AlignIcons.right}</ToolBtn>
          <Sep />
          <ToolBtn title="Aligner en haut" onClick={() => align("top")}>{AlignIcons.top}</ToolBtn>
          <ToolBtn title="Centrer verticalement" onClick={() => align("centerV")}>{AlignIcons.centerV}</ToolBtn>
          <ToolBtn title="Aligner en bas" onClick={() => align("bottom")}>{AlignIcons.bottom}</ToolBtn>
          <Sep />
        </>
      )}

      {/* ── Single: type-specific ── */}
      {single && (
        <>
          {/* Image */}
          {single.type === "image" && (
            <>
              <ToolBtn
                title="Couvrir (rogner pour remplir)"
                active={(single as ImageElement).objectFit !== "contain"}
                onClick={() => upd(single.id, { objectFit: "cover" })}
              >
                Cover
              </ToolBtn>
              <ToolBtn
                title="Adapter (afficher entièrement)"
                active={(single as ImageElement).objectFit === "contain"}
                onClick={() => upd(single.id, { objectFit: "contain" })}
              >
                Fit
              </ToolBtn>
              <Sep />
            </>
          )}

          {/* Text */}
          {single.type === "text" && (
            <>
              <ToolBtn
                title="Gras"
                active={(single as TextElement).bold}
                onClick={() => upd(single.id, { bold: !(single as TextElement).bold })}
              >
                <strong className="font-bold">B</strong>
              </ToolBtn>
              <ToolBtn
                title="Italique"
                active={(single as TextElement).italic}
                onClick={() => upd(single.id, { italic: !(single as TextElement).italic })}
              >
                <em>I</em>
              </ToolBtn>
              <input
                type="number"
                value={(single as TextElement).fontSize}
                onChange={(e) =>
                  upd(single.id, { fontSize: Math.max(6, Math.min(300, Number(e.target.value))) })
                }
                onMouseDown={(e) => e.stopPropagation()}
                className="w-10 bg-transparent text-[11px] text-[var(--text-primary)] text-center outline-none border border-[var(--border-subtle)] rounded h-[22px] mx-0.5"
                min={6}
                max={300}
                title="Taille de police"
              />
              <ColorSwatch
                value={(single as TextElement).color}
                onChange={(v) => upd(single.id, { color: v })}
                title="Couleur du texte"
              />
              <Sep />
            </>
          )}

          {/* Color block */}
          {single.type === "color" && (
            <>
              <ColorSwatch
                value={(single as ColorElement).color}
                onChange={(v) => upd(single.id, { color: v })}
                title="Couleur du bloc"
              />
              <Sep />
            </>
          )}

          {/* Sticky */}
          {single.type === "sticky" && (
            <>
              <ColorSwatch
                value={(single as StickyElement).backgroundColor}
                onChange={(v) => upd(single.id, { backgroundColor: v })}
                title="Couleur de fond"
              />
              <ColorSwatch
                value={(single as StickyElement).textColor}
                onChange={(v) => upd(single.id, { textColor: v })}
                title="Couleur du texte"
                label="A"
              />
              <Sep />
            </>
          )}

          {/* Opacity (single only) */}
          <OpacitySlider
            value={single.opacity ?? 1}
            onChange={(v) => upd(single.id, { opacity: v })}
          />
          <Sep />
        </>
      )}

      {/* Delete */}
      <ToolBtn title="Supprimer (Suppr)" onClick={onDeleteSelected} danger>
        ✕
      </ToolBtn>
    </div>
  );
}
