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

// Mini lock/unlock SVG icons for the toolbar
const LockClosedIcon = () => (
  <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" aria-hidden>
    <rect x="1.5" y="5" width="7" height="5.5" rx="1.2" />
    <path d="M3 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const LockOpenIcon = () => (
  <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" aria-hidden>
    <rect x="1.5" y="5" width="7" height="5.5" rx="1.2" />
    <path d="M3 5V3.5a2 2 0 0 1 4 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

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

// ── Layout unit helpers ───────────────────────────────────────────────────────
// A "unit" is the atom of layout: either a group (all elements sharing a groupId,
// treated as a single bounding-box) or a standalone element.

type Unit = {
  ids: string[];
  elements: CanvasElement[];
  /** Bounding box of the unit in canvas coordinates */
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Partition selected elements into units (one per group + one per standalone). */
function buildUnits(els: CanvasElement[]): Unit[] {
  const groupMap = new Map<string, CanvasElement[]>();
  const singles: CanvasElement[] = [];

  for (const el of els) {
    if (el.groupId) {
      const g = groupMap.get(el.groupId) ?? [];
      g.push(el);
      groupMap.set(el.groupId, g);
    } else {
      singles.push(el);
    }
  }

  const units: Unit[] = [];

  for (const [, members] of groupMap) {
    const x = Math.min(...members.map((e) => e.x));
    const y = Math.min(...members.map((e) => e.y));
    const w = Math.max(...members.map((e) => e.x + e.w)) - x;
    const h = Math.max(...members.map((e) => e.y + e.h)) - y;
    units.push({ ids: members.map((e) => e.id), elements: members, x, y, w, h });
  }

  for (const el of singles) {
    units.push({ ids: [el.id], elements: [el], x: el.x, y: el.y, w: el.w, h: el.h });
  }

  return units;
}

/**
 * Build the patch list to move a unit's top-left to (newX, newY).
 *
 * - Single element → move + resize to (newW, newH) when provided.
 * - Group          → translate only (preserve internal layout).
 *                    Scaling would produce a "grid inside the group" effect,
 *                    so groups always keep their actual member sizes.
 *                    Pass (newW, newH) here to influence nothing for groups —
 *                    the caller should use (unit.w, unit.h) for spacing instead.
 */
function unitPatches(
  unit: Unit,
  newX: number,
  newY: number,
  newW?: number,
  newH?: number,
): Array<{ id: string; patch: Patch }> {
  if (unit.ids.length === 1) {
    const el = unit.elements[0];
    return [
      {
        id: el.id,
        patch: { x: newX, y: newY, w: newW ?? el.w, h: newH ?? el.h },
      },
    ];
  }

  // Group: translate every member by the same delta — do NOT scale.
  // Scaling members to fit a "cell" creates a nested grid effect and breaks
  // the user's intentional internal arrangement.
  const dx = newX - unit.x;
  const dy = newY - unit.y;
  return unit.elements.map((el) => ({
    id: el.id,
    patch: { x: el.x + dx, y: el.y + dy },
  }));
}

// ── Layout / Arrangement SVG icons ──────────────────────────────────────────

const LayoutIcons = {
  grid: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="0" y="0" width="5" height="5" rx="0.5" />
      <rect x="7" y="0" width="5" height="5" rx="0.5" />
      <rect x="0" y="7" width="5" height="5" rx="0.5" />
      <rect x="7" y="7" width="5" height="5" rx="0.5" />
    </svg>
  ),
  masonry: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="0" y="0" width="5" height="7" rx="0.5" />
      <rect x="0" y="9" width="5" height="3" rx="0.5" />
      <rect x="7" y="0" width="5" height="3" rx="0.5" />
      <rect x="7" y="5" width="5" height="7" rx="0.5" />
    </svg>
  ),
};

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

  // Lock helpers — computed from current selection
  const anyLocked = selected.some((el) => el.locked);
  const allLocked = selected.length > 0 && selected.every((el) => el.locked);
  const toggleLock = () =>
    onUpdateMany(selected.map((el) => ({ id: el.id, patch: { locked: !allLocked } })));

  // ── Grid arrangement ──
  // Positions units in a grid without resizing anything.
  // Column widths = max unit width per column, row heights = max unit height per row,
  // so no unit ever overlaps its neighbour regardless of size differences.
  const applyGrid = () => {
    if (selected.length < 2) return;
    const units = buildUnits(selected);
    if (units.length < 2) return;

    // Choose cols to minimise empty cells in the last row.
    // ceil(sqrt(n)) gives a near-square grid but can leave the last row half-empty
    // (e.g. 3 items → 2 cols → row 0 full, row 1 has 1 item + 1 empty cell).
    // If the empty count ≥ half the row, switch to one fewer row (= more cols),
    // which often eliminates the gap entirely (3 items → 3 cols → 1 full row).
    const sqrtCols  = Math.ceil(Math.sqrt(units.length));
    const sqrtRows  = Math.ceil(units.length / sqrtCols);
    const lastEmpty = sqrtCols * sqrtRows - units.length;
    const cols = (lastEmpty >= sqrtCols / 2 && sqrtRows > 1)
      ? Math.min(units.length, Math.ceil(units.length / (sqrtRows - 1)))
      : Math.max(2, sqrtCols);

    const gap    = 12;
    const startX = Math.min(...units.map((u) => u.x));
    const startY = Math.min(...units.map((u) => u.y));

    // Sort by height descending so tall units cluster in the first rows.
    // This minimises per-row height variance and the resulting vertical gaps:
    // a row of similarly-tall units leaves no dead space below shorter neighbours.
    const sorted = [...units].sort((a, b) => b.h - a.h);

    // Per-column max width & per-row max height based on actual unit sizes
    const rows = Math.ceil(sorted.length / cols);
    const colWidths  = Array<number>(cols).fill(0);
    const rowHeights = Array<number>(rows).fill(0);
    sorted.forEach((u, i) => {
      colWidths[i % cols]              = Math.max(colWidths[i % cols],              u.w);
      rowHeights[Math.floor(i / cols)] = Math.max(rowHeights[Math.floor(i / cols)], u.h);
    });

    // Prefix sums → absolute x/y origin of each column/row
    const colX = colWidths.reduce<number[]>((acc, w, i) => {
      acc.push(i === 0 ? 0 : acc[i - 1] + colWidths[i - 1] + gap);
      return acc;
    }, []);
    const rowY = rowHeights.reduce<number[]>((acc, h, i) => {
      acc.push(i === 0 ? 0 : acc[i - 1] + rowHeights[i - 1] + gap);
      return acc;
    }, []);

    const updates: Array<{ id: string; patch: Patch }> = [];
    sorted.forEach((unit, i) => {
      updates.push(...unitPatches(unit, startX + colX[i % cols], startY + rowY[Math.floor(i / cols)]));
    });
    onUpdateMany(updates);
  };

  // ── Masonry arrangement ──
  // Fills columns shortest-first without resizing anything.
  // Column stride = max unit width so wider units never bleed into adjacent columns.
  const applyMasonry = () => {
    if (selected.length < 2) return;
    const units = buildUnits(selected);
    if (units.length < 2) return;

    // Same cols heuristic as grid: avoid leaving the last slots empty
    const sqrtCols  = Math.ceil(Math.sqrt(units.length));
    const sqrtRows  = Math.ceil(units.length / sqrtCols);
    const lastEmpty = sqrtCols * sqrtRows - units.length;
    const cols = (lastEmpty >= sqrtCols / 2 && sqrtRows > 1)
      ? Math.min(units.length, Math.ceil(units.length / (sqrtRows - 1)))
      : Math.max(2, sqrtCols);

    const gap    = 12;
    const startX = Math.min(...units.map((u) => u.x));
    const startY = Math.min(...units.map((u) => u.y));

    // Sort left→right, top→bottom for a natural fill order
    const sorted = [...units].sort((a, b) => a.x - b.x || a.y - b.y);

    // Pass 1 — assign each unit to a column (shortest-column-first).
    // We use a temporary uniform stride to drive column assignment only;
    // actual x positions are computed in pass 2 from real per-column widths.
    const colHtmp = Array<number>(cols).fill(0);
    const assignments: Array<{ unit: Unit; col: number; relY: number }> = [];
    for (const unit of sorted) {
      const col = colHtmp.indexOf(Math.min(...colHtmp));
      assignments.push({ unit, col, relY: colHtmp[col] });
      colHtmp[col] += unit.h + gap;
    }

    // Pass 2 — per-column max width → tight x positions with no wasted space.
    // A column of narrow images no longer inherits the stride of a wide group
    // sitting in another column (which was the source of the "empty column" look).
    const colWidths = Array<number>(cols).fill(0);
    for (const { unit, col } of assignments) {
      colWidths[col] = Math.max(colWidths[col], unit.w);
    }
    const colX = colWidths.reduce<number[]>((acc, w, i) => {
      acc.push(i === 0 ? 0 : acc[i - 1] + colWidths[i - 1] + gap);
      return acc;
    }, []);

    const updates: Array<{ id: string; patch: Patch }> = [];
    for (const { unit, col, relY } of assignments) {
      updates.push(...unitPatches(unit, startX + colX[col], startY + relY));
    }
    onUpdateMany(updates);
  };

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
          <ToolBtn title="Agencer en grille uniforme" onClick={applyGrid}>{LayoutIcons.grid}</ToolBtn>
          <ToolBtn title="Agencer en maçonnerie (masonry)" onClick={applyMasonry}>{LayoutIcons.masonry}</ToolBtn>
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

      {/* Lock / Unlock */}
      <Sep />
      <ToolBtn
        title={allLocked ? "Déverrouiller (Ctrl+L)" : "Verrouiller (Ctrl+L)"}
        onClick={toggleLock}
        active={anyLocked}
      >
        {allLocked ? <LockClosedIcon /> : <LockOpenIcon />}
      </ToolBtn>

      {/* Delete */}
      <Sep />
      <ToolBtn title="Supprimer (Suppr)" onClick={onDeleteSelected} danger>
        ✕
      </ToolBtn>
    </div>
  );
}
