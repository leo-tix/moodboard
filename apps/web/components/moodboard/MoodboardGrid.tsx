"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MoodboardData, CanvasElement } from "@/lib/moodboard/types";
import { getImageUrl, getThumbnailUrl } from "@/lib/storage/urls";

interface Props {
  initialMoodboards: MoodboardData[];
}

export function MoodboardGrid({ initialMoodboards }: Props) {
  const router = useRouter();
  const [moodboards, setMoodboards] = useState(initialMoodboards);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/moodboards", { method: "POST" });
      const data = await res.json();
      router.push(`/moodboards/${data.id}/edit`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette planche ?")) return;
    await fetch(`/api/moodboards/${id}`, { method: "DELETE" });
    setMoodboards((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-medium text-[var(--text-primary)]">Planches</h1>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-3 py-1.5 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)] transition-colors disabled:opacity-50"
        >
          {creating ? "Création…" : "+ Nouvelle planche"}
        </button>
      </div>

      {/* Grid */}
      {moodboards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-[var(--text-tertiary)] text-sm">Aucune planche pour l&apos;instant</p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Créer ma première planche →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {moodboards.map((m) => (
            <MoodboardCard key={m.id} moodboard={m} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Mini canvas preview ───────────────────────────────────────────────────────
// Projects canvas elements into a virtual 16×9 coordinate space expressed as
// CSS percentages — no JavaScript measurement needed, fully responsive.

function MoodboardPreview({
  canvasData,
  background,
}: {
  canvasData: CanvasElement[];
  background: string;
}) {
  if (canvasData.length === 0) {
    return (
      <div
        className="aspect-video w-full flex items-center justify-center"
        style={{ backgroundColor: background }}
      >
        <span className="text-[var(--text-tertiary)] text-xs opacity-40">Planche vide</span>
      </div>
    );
  }

  // Bounding box of all elements
  const minX = Math.min(...canvasData.map((e) => e.x));
  const minY = Math.min(...canvasData.map((e) => e.y));
  const maxX = Math.max(...canvasData.map((e) => e.x + e.w));
  const maxY = Math.max(...canvasData.map((e) => e.y + e.h));
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);

  // Virtual 16×9 coordinate space (matches aspect-video container).
  // Padding creates breathing room around the content.
  const VIRT_W = 16;
  const VIRT_H = 9;
  const PAD = 0.55; // virtual units on each side

  // Uniform scale to fit the bounding box inside the padded virtual area
  const scale = Math.min(
    (VIRT_W - PAD * 2) / bw,
    (VIRT_H - PAD * 2) / bh
  );

  // Center the scaled bounding box inside the virtual viewport
  const offsetX = (VIRT_W - bw * scale) / 2;
  const offsetY = (VIRT_H - bh * scale) / 2;

  // Sort by effective zIndex (sticky notes always on top, matching the editor)
  const sorted = [...canvasData].sort((a, b) => {
    const az = a.type === "sticky" ? a.zIndex + 100000 : a.zIndex;
    const bz = b.type === "sticky" ? b.zIndex + 100000 : b.zIndex;
    return az - bz;
  });

  return (
    <div
      className="aspect-video w-full relative overflow-hidden"
      style={{ backgroundColor: background }}
    >
      {sorted.map((el) => {
        // Map canvas coordinates → virtual units → CSS percentages
        const vx = (el.x - minX) * scale + offsetX;
        const vy = (el.y - minY) * scale + offsetY;
        const vw = el.w * scale;
        const vh = el.h * scale;

        const baseStyle: React.CSSProperties = {
          position: "absolute",
          // left/width are % of parent width; top/height are % of parent height.
          // Both work correctly because aspect-video gives the parent a defined height.
          left:   `${(vx / VIRT_W) * 100}%`,
          top:    `${(vy / VIRT_H) * 100}%`,
          width:  `${(vw / VIRT_W) * 100}%`,
          height: `${(vh / VIRT_H) * 100}%`,
          opacity: el.opacity ?? 1,
          borderRadius: 3,
          overflow: "hidden",
        };

        if (el.type === "image") {
          // Use thumbnailKey when available for faster preview loading
          const previewSrc = el.thumbnailKey
            ? getThumbnailUrl(el.thumbnailKey)
            : getImageUrl(el.storageKey);
          return (
            <div key={el.id} style={baseStyle}>
              <img
                src={previewSrc}
                alt=""
                loading="lazy"
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: el.objectFit ?? "cover",
                  display: "block",
                }}
              />
            </div>
          );
        }

        if (el.type === "color") {
          return (
            <div key={el.id} style={{ ...baseStyle, backgroundColor: el.color }} />
          );
        }

        if (el.type === "sticky") {
          return (
            <div key={el.id} style={{ ...baseStyle, backgroundColor: el.backgroundColor }} />
          );
        }

        if (el.type === "text") {
          // Text is unreadable at thumbnail scale — show as a faint tinted block
          return (
            <div
              key={el.id}
              style={{ ...baseStyle, backgroundColor: `${el.color}26` /* ~15% opacity */ }}
            />
          );
        }

        return null;
      })}
    </div>
  );
}

// ── Moodboard card ────────────────────────────────────────────────────────────

function MoodboardCard({
  moodboard,
  onDelete,
}: {
  moodboard: MoodboardData;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  const imageCount = moodboard.canvasData.filter((el) => el.type === "image").length;
  const updatedAt = new Date(moodboard.updatedAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <div
      className="group relative rounded-lg border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-elevated)] cursor-pointer hover:border-[var(--border-default)] transition-colors"
      onClick={() => router.push(`/moodboards/${moodboard.id}/edit`)}
    >
      {/* Live canvas preview */}
      <MoodboardPreview canvasData={moodboard.canvasData} background={moodboard.background} />

      {/* Info */}
      <div className="px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-[var(--text-primary)] truncate">{moodboard.title}</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
            {updatedAt} · {imageCount} image{imageCount !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(moodboard.id); }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 transition-all text-xs"
          title="Supprimer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
