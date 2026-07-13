"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { loadImageForCanvas } from "@/lib/image/loadForCanvas";

// ── Module de partage "folder lab" (Phase 5) ────────────────────────────────
// Clone fidèle de https://folderlab.javii.tools/ : un dossier macOS d'où
// débordent des cartes photos, teinte réglable, styles d'agencement, export.
// Appliqué aux images d'une visite. Note produit : l'app étant perso
// (mono-tenant), les fonctions "premium" de l'original (Glass, export vidéo)
// sont ici librement accessibles — pas de gating.

export interface FolderImage {
  id: string;
  thumbnailKey: string | null;
  storageKey: string;
}

type ArrangeStyle = "tucked" | "peek" | "open" | "spill";
type Orientation = "vertical" | "horizontal";

const MAX = 6;

// Teintes façon dossiers macOS (le nuancier de gauche).
const PALETTE = [
  "#5b9bd5", "#4a78b5", "#7a8aa8", "#8a7fb0", "#a86fa8",
  "#c56f8f", "#c98a5c", "#c9a94e", "#8faa5c", "#5fae87",
  "#5aa9a9", "#7f8c99", "#9c8f80", "#6d7a86", "#b06a5a",
  "#6a6f9c", "#4f9e6a", "#b58fb0",
];

const STYLES: Record<ArrangeStyle, { rise: number; spread: number; dx: number; arc: number }> = {
  tucked: { rise: 16, spread: 5, dx: 16, arc: 6 },
  peek: { rise: 40, spread: 8, dx: 30, arc: 12 },
  open: { rise: 78, spread: 11, dx: 48, arc: 20 },
  spill: { rise: 120, spread: 15, dx: 70, arc: 32 },
};

// Scène (unités logiques, l'export les multiplie par le scale).
const SCENE_W = 560;
const SCENE_H = 470;
const FOLDER_W = 300;
const FOLDER_H = 200;
const FOLDER_X = (SCENE_W - FOLDER_W) / 2;
const FOLDER_Y = SCENE_H - FOLDER_H - 24;
const POCKET_TOP_OFFSET = 54; // le devant du dossier démarre plus bas que le dos
const CARD_BASE_BOTTOM = FOLDER_Y + 92; // bas de carte (caché derrière le devant)

function cardDims(orientation: Orientation) {
  return orientation === "vertical" ? { w: 128, h: 168 } : { w: 172, h: 122 };
}

interface CardLayout {
  cx: number; // centre X dans la scène
  bottom: number; // Y du bas de la carte
  rot: number; // rotation deg
}

function layoutCards(n: number, style: ArrangeStyle): CardLayout[] {
  const p = STYLES[style];
  const folderCx = FOLDER_X + FOLDER_W / 2;
  return Array.from({ length: n }, (_, i) => {
    const c = i - (n - 1) / 2; // position relative au centre (…-1,0,1…)
    return {
      cx: folderCx + c * p.dx,
      // les cartes extérieures retombent (arc) et montent un peu moins
      bottom: CARD_BASE_BOTTOM - p.rise + Math.abs(c) * p.arc,
      rot: c * p.spread,
    };
  });
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function FolderLab({ images }: { images: FolderImage[] }) {
  const [colorIdx, setColorIdx] = useState(0);
  const [style, setStyle] = useState<ArrangeStyle>("spill");
  const [orientation, setOrientation] = useState<Orientation>("vertical");
  const [frame, setFrame] = useState(true);
  const [glass, setGlass] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => images.slice(0, 4).map((i) => i.id));
  const [shakeKey, setShakeKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const byId = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);
  const selected = selectedIds.map((id) => byId.get(id)).filter((i): i is FolderImage => Boolean(i));
  const color = PALETTE[colorIdx];
  const dims = cardDims(orientation);
  const layouts = useMemo(() => layoutCards(selected.length, style), [selected.length, style]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX) return prev;
      return [...prev, id];
    });
  };

  // ── Rendu canvas (export PNG, fond transparent) ──
  const drawScene = async (scale: number): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement("canvas");
    canvas.width = SCENE_W * scale;
    canvas.height = SCENE_H * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);

    const dark = shade(color, -34);

    // Dos du dossier (avec petit onglet en haut à gauche)
    ctx.fillStyle = dark;
    roundRectPath(ctx, FOLDER_X, FOLDER_Y, FOLDER_W, FOLDER_H, 24);
    ctx.fill();
    roundRectPath(ctx, FOLDER_X + 16, FOLDER_Y - 12, 96, 26, 12);
    ctx.fill();

    // Cartes (chargées en amont, dans l'ordre)
    const loaded = await Promise.all(
      selected.map((img) => loadImageForCanvas(img.storageKey).catch(() => null)),
    );
    layouts.forEach((lay, i) => {
      const img = loaded[i];
      const { w, h } = dims;
      ctx.save();
      ctx.translate(lay.cx, lay.bottom - h / 2);
      ctx.rotate((lay.rot * Math.PI) / 180);
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      if (frame) {
        ctx.fillStyle = "#fff";
        roundRectPath(ctx, -w / 2, -h / 2, w, h, 14);
        ctx.fill();
      }
      ctx.shadowColor = "transparent";
      const pad = frame ? 6 : 0;
      const iw = w - pad * 2;
      const ih = h - pad * 2;
      roundRectPath(ctx, -iw / 2, -ih / 2, iw, ih, frame ? 9 : 14);
      ctx.clip();
      if (img) {
        // couvrir le cadre (cover)
        const ar = img.width / img.height;
        const tr = iw / ih;
        let dw = iw, dh = ih, dx = -iw / 2, dy = -ih / 2;
        if (ar > tr) { dw = ih * ar; dx = -dw / 2; } else { dh = iw / ar; dy = -dh / 2; }
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = "#333";
        ctx.fillRect(-iw / 2, -ih / 2, iw, ih);
      }
      ctx.restore();
    });

    // Devant du dossier (poche) — recouvre le bas des cartes
    const py = FOLDER_Y + POCKET_TOP_OFFSET;
    const ph = FOLDER_H - POCKET_TOP_OFFSET;
    ctx.fillStyle = color;
    roundRectPath(ctx, FOLDER_X, py, FOLDER_W, ph, 24);
    ctx.fill();
    // reflet clair en haut de la poche
    ctx.fillStyle = shade(color, 22);
    roundRectPath(ctx, FOLDER_X, py, FOLDER_W, 20, 24);
    ctx.fill();
    if (glass) {
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      roundRectPath(ctx, FOLDER_X, py, FOLDER_W, ph, 24);
      ctx.fill();
    }

    return canvas;
  };

  const downloadCanvas = (canvas: HTMLCanvasElement, name: string) =>
    new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          a.click();
          URL.revokeObjectURL(url);
        }
        resolve();
      }, "image/png");
    });

  const exportPNG = async () => {
    if (selected.length === 0 || exporting) return;
    setExporting(true);
    try {
      const canvas = await drawScene(3);
      await downloadCanvas(canvas, "dossier.png");
    } finally {
      setExporting(false);
    }
  };

  // Export 9:16 (story/reel) — la scène du dossier centrée sur un canvas
  // vertical 1080×1920, sur un fond sombre (partage Instagram/TikTok).
  const exportStory = async () => {
    if (selected.length === 0 || exporting) return;
    setExporting(true);
    try {
      const scene = await drawScene(2); // 1120×940
      const W = 1080, H = 1920;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, W, H);
      const scale = (W * 0.86) / scene.width;
      const dw = scene.width * scale;
      const dh = scene.height * scale;
      ctx.drawImage(scene, (W - dw) / 2, (H - dh) / 2, dw, dh);
      await downloadCanvas(canvas, "dossier-story.png");
    } finally {
      setExporting(false);
    }
  };

  const pocketTop = FOLDER_Y + POCKET_TOP_OFFSET;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-6 py-10 px-4 select-none">
      <div className="flex items-start gap-6">
        {/* Nuancier de teinte */}
        <div className="grid grid-cols-3 gap-1.5 pt-6">
          {PALETTE.map((c, i) => (
            <button
              key={c}
              onClick={() => setColorIdx(i)}
              className={cn(
                "w-6 h-6 rounded-full transition-transform",
                colorIdx === i ? "ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0a] scale-110" : "hover:scale-105",
              )}
              style={{ background: c }}
              title="Teinte du dossier"
            />
          ))}
        </div>

        {/* Scène */}
        <motion.div
          key={shakeKey}
          animate={shakeKey ? { rotate: [0, -2.5, 2.5, -1.5, 1.5, 0], x: [0, -4, 4, -2, 2, 0] } : {}}
          transition={{ duration: 0.5 }}
          className="relative"
          style={{ width: SCENE_W, height: SCENE_H }}
        >
          {/* Dos du dossier */}
          <div
            className="absolute rounded-[24px]"
            style={{ left: FOLDER_X, top: FOLDER_Y, width: FOLDER_W, height: FOLDER_H, background: shade(color, -34) }}
          />
          <div
            className="absolute rounded-[12px]"
            style={{ left: FOLDER_X + 16, top: FOLDER_Y - 12, width: 96, height: 26, background: shade(color, -34) }}
          />

          {/* Cartes */}
          {selected.map((img, i) => {
            const lay = layouts[i];
            return (
              <motion.div
                key={img.id}
                layout
                initial={false}
                animate={{ rotate: lay.rot }}
                transition={{ type: "spring", stiffness: 240, damping: 26 }}
                className={cn(
                  "absolute overflow-hidden",
                  frame ? "bg-white p-1.5 rounded-[14px] shadow-xl" : "rounded-[14px] shadow-xl",
                )}
                style={{
                  width: dims.w,
                  height: dims.h,
                  left: lay.cx - dims.w / 2,
                  top: lay.bottom - dims.h,
                  zIndex: 10 + i,
                }}
              >
                {img.thumbnailKey && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getThumbnailUrl(img.thumbnailKey)}
                    alt=""
                    className={cn("w-full h-full object-cover", frame ? "rounded-[9px]" : "rounded-[14px]")}
                    draggable={false}
                  />
                )}
              </motion.div>
            );
          })}

          {/* Devant du dossier (poche) */}
          <div
            className="absolute rounded-[24px] overflow-hidden"
            style={{ left: FOLDER_X, top: pocketTop, width: FOLDER_W, height: FOLDER_H - POCKET_TOP_OFFSET, background: color, zIndex: 100 }}
          >
            <div className="absolute inset-x-0 top-0 h-5" style={{ background: shade(color, 22) }} />
            {glass && <div className="absolute inset-0 bg-white/[0.16] backdrop-blur-[1px]" />}
          </div>
        </motion.div>

        {/* Styles + options */}
        <div className="flex flex-col gap-2 pt-6 w-32">
          {(["tucked", "peek", "open", "spill"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize",
                style === s ? "bg-[#1a1a1a] text-white" : "bg-[#e8e8e8] text-[#333] hover:bg-white",
              )}
            >
              {s === "tucked" ? "Tucked" : s === "peek" ? "Peek" : s === "open" ? "Open" : "Spill"}
            </button>
          ))}
          <button
            onClick={() => setOrientation((o) => (o === "vertical" ? "horizontal" : "vertical"))}
            className={cn(
              "mt-1 px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-1.5",
              orientation === "vertical" ? "bg-[#3b82f6] text-white" : "bg-[#e8e8e8] text-[#333] hover:bg-white",
            )}
          >
            ✂ {orientation === "vertical" ? "Vertical" : "Horizontal"}
          </button>
          <button
            onClick={() => setFrame((f) => !f)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-1.5",
              frame ? "bg-[#1a1a1a] text-white" : "bg-[#e8e8e8] text-[#333] hover:bg-white",
            )}
          >
            🖼 Frame
          </button>
          <button
            onClick={() => setGlass((g) => !g)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-1.5",
              glass ? "bg-[#1a1a1a] text-white" : "bg-[#e8e8e8] text-[#333] hover:bg-white",
            )}
          >
            ＋ Glass
          </button>
        </div>
      </div>

      {/* Barre d'actions */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          disabled={selected.length >= MAX && !pickerOpen}
          className="px-4 py-2 rounded-full text-sm font-medium bg-[#e8e8e8] text-[#333] hover:bg-white transition-colors disabled:opacity-40"
        >
          + add ({selected.length}/{MAX})
        </button>
        <button
          onClick={() => setShakeKey((k) => k + 1)}
          className="px-4 py-2 rounded-full text-sm font-medium bg-[#e8e8e8] text-[#333] hover:bg-white transition-colors"
        >
          ⚡ shake
        </button>
        <button
          onClick={() => { setSelectedIds([]); setPickerOpen(false); }}
          className="px-4 py-2 rounded-full text-sm font-medium bg-[#e8e8e8] text-[#333] hover:bg-white transition-colors"
        >
          clear
        </button>
        <button
          onClick={exportPNG}
          disabled={selected.length === 0 || exporting}
          className="px-4 py-2 rounded-full text-sm font-medium bg-[#1a1a1a] text-white hover:bg-black transition-colors disabled:opacity-50"
        >
          {exporting ? "…" : "↓ PNG"}
        </button>
        <button
          onClick={exportStory}
          disabled={selected.length === 0 || exporting}
          className="px-4 py-2 rounded-full text-sm font-medium bg-[#1a1a1a] text-white hover:bg-black transition-colors disabled:opacity-50"
        >
          {exporting ? "…" : "↓ 9:16"}
        </button>
      </div>

      {/* Miniatures sélectionnées (clic = retirer) */}
      {selected.length > 0 && (
        <div className="flex items-center gap-2">
          {selected.map((img) => (
            <button
              key={img.id}
              onClick={() => toggle(img.id)}
              className="w-10 h-10 rounded-lg overflow-hidden ring-1 ring-white/20 hover:ring-red-400 transition-all"
              title="Retirer"
            >
              {img.thumbnailKey && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getThumbnailUrl(img.thumbnailKey)} alt="" className="w-full h-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Sélecteur d'images de la visite */}
      {pickerOpen && (
        <div className="max-w-lg w-full rounded-xl bg-[#141414] border border-white/10 p-3">
          <p className="text-xs text-white/50 mb-2">Choisir dans les images de la visite ({selected.length}/{MAX})</p>
          <div className="grid grid-cols-8 gap-1.5 max-h-40 overflow-y-auto">
            {images.map((img) => {
              const isSel = selectedIds.includes(img.id);
              return (
                <button
                  key={img.id}
                  onClick={() => toggle(img.id)}
                  className={cn(
                    "aspect-square rounded-md overflow-hidden ring-2 transition-all",
                    isSel ? "ring-[#3b82f6]" : "ring-transparent hover:ring-white/30",
                  )}
                >
                  {img.thumbnailKey && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={getThumbnailUrl(img.thumbnailKey)} alt="" className="w-full h-full object-cover" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
