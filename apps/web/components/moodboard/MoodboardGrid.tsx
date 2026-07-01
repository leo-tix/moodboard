"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MoodboardData, MoodboardFolderData, CanvasElement } from "@/lib/moodboard/types";
import { getImageUrl, getThumbnailUrl } from "@/lib/storage/urls";
import { cn } from "@/lib/utils";

interface Props {
  initialMoodboards: MoodboardData[];
  initialFolders: MoodboardFolderData[];
}

type FolderFilter = "all" | "none" | string;

export function MoodboardGrid({ initialMoodboards, initialFolders }: Props) {
  const router = useRouter();
  const [moodboards, setMoodboards] = useState(initialMoodboards);
  const [folders, setFolders] = useState(initialFolders);
  const [creating, setCreating] = useState(false);
  const [activeFolder, setActiveFolder] = useState<FolderFilter>("all");

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<FolderFilter | null>(null);

  const filtered = useMemo(() => {
    return moodboards
      .filter((m) => {
        if (activeFolder === "all") return true;
        if (activeFolder === "none") return !m.folderId;
        return m.folderId === activeFolder;
      })
      .sort((a, b) => a.order - b.order);
  }, [moodboards, activeFolder]);

  // ── Board CRUD ──────────────────────────────────────────────────────────────

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

  // ── Folder CRUD ─────────────────────────────────────────────────────────────

  const createFolder = async () => {
    const name = newFolderName.trim();
    setShowNewFolder(false);
    setNewFolderName("");
    if (!name) return;
    const res = await fetch("/api/moodboard-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const folder = await res.json();
    setFolders((prev) => [...prev, folder]);
    setActiveFolder(folder.id);
  };

  const saveFolderName = async (id: string) => {
    const name = editingName.trim();
    setEditingFolderId(null);
    if (!name) return;
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    await fetch(`/api/moodboard-folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };

  const deleteFolder = async (id: string) => {
    if (!confirm("Supprimer ce dossier ? Les planches qu'il contient ne seront pas supprimées.")) return;
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setMoodboards((prev) => prev.map((m) => (m.folderId === id ? { ...m, folderId: null } : m)));
    if (activeFolder === id) setActiveFolder("all");
    await fetch(`/api/moodboard-folders/${id}`, { method: "DELETE" });
  };

  // ── Drag and drop ───────────────────────────────────────────────────────────

  const persistReorder = (items: { id: string; order: number; folderId?: string | null }[]) => {
    fetch("/api/moodboards/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }).catch(() => {});
  };

  const handleDropOnCard = (targetId: string) => {
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;
    const fromIndex = filtered.findIndex((m) => m.id === draggedId);
    const toIndex = filtered.findIndex((m) => m.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...filtered];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const items = reordered.map((m, i) => ({ id: m.id, order: i }));

    const orderMap = new Map(items.map((it) => [it.id, it.order]));
    setMoodboards((prev) => prev.map((m) => (orderMap.has(m.id) ? { ...m, order: orderMap.get(m.id)! } : m)));
    persistReorder(items);
  };

  const handleDropOnFolder = (folderId: string | null) => {
    setDragOverFolder(null);
    if (!draggedId) return;
    const board = moodboards.find((m) => m.id === draggedId);
    if (!board || board.folderId === folderId) return;
    setMoodboards((prev) => prev.map((m) => (m.id === draggedId ? { ...m, folderId } : m)));
    persistReorder([{ id: draggedId, order: board.order, folderId }]);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-medium text-[var(--text-primary)]">Planches</h1>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-3 py-1.5 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md text-[var(--text-primary)] transition-colors disabled:opacity-50"
        >
          {creating ? "Création…" : "+ Nouvelle planche"}
        </button>
      </div>

      {/* Folder tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-6">
        <FolderPill
          label="Toutes"
          active={activeFolder === "all"}
          onClick={() => setActiveFolder("all")}
        />
        <FolderPill
          label="Sans dossier"
          active={activeFolder === "none"}
          onClick={() => setActiveFolder("none")}
          onDragOver={(e) => { e.preventDefault(); setDragOverFolder("none"); }}
          onDragLeave={() => setDragOverFolder(null)}
          onDrop={(e) => { e.preventDefault(); handleDropOnFolder(null); }}
          dragOver={dragOverFolder === "none"}
        />
        {folders.map((f) =>
          editingFolderId === f.id ? (
            <input
              key={f.id}
              autoFocus
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => saveFolderName(f.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveFolderName(f.id);
                if (e.key === "Escape") setEditingFolderId(null);
              }}
              className="px-2.5 py-1 text-xs rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] outline-none w-28"
            />
          ) : (
            <FolderPill
              key={f.id}
              label={f.name}
              active={activeFolder === f.id}
              onClick={() => setActiveFolder(f.id)}
              onDoubleClick={() => { setEditingFolderId(f.id); setEditingName(f.name); }}
              onDelete={() => deleteFolder(f.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOverFolder(f.id); }}
              onDragLeave={() => setDragOverFolder(null)}
              onDrop={(e) => { e.preventDefault(); handleDropOnFolder(f.id); }}
              dragOver={dragOverFolder === f.id}
            />
          )
        )}

        {showNewFolder ? (
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={createFolder}
            onKeyDown={(e) => {
              if (e.key === "Enter") createFolder();
              if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
            }}
            placeholder="Nom du dossier"
            className="px-2.5 py-1 text-xs rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] outline-none w-28"
          />
        ) : (
          <button
            onClick={() => setShowNewFolder(true)}
            className="px-2.5 py-1 text-xs rounded-full border border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-strong)] transition-colors"
          >
            + Dossier
          </button>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-[var(--text-tertiary)] text-sm">
            {moodboards.length === 0 ? "Aucune planche pour l'instant" : "Aucune planche dans ce dossier"}
          </p>
          {moodboards.length === 0 && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Créer ma première planche →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((m) => (
            <MoodboardCard
              key={m.id}
              moodboard={m}
              onDelete={handleDelete}
              dragging={draggedId === m.id}
              dragOver={dragOverId === m.id}
              onDragStart={() => setDraggedId(m.id)}
              onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
              onDragOver={() => setDragOverId(m.id)}
              onDrop={() => handleDropOnCard(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Folder pill ────────────────────────────────────────────────────────────────

function FolderPill({
  label,
  active,
  onClick,
  onDoubleClick,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOver,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onDelete?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  dragOver?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "group/pill flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors",
        active
          ? "bg-[var(--bg-elevated)] border-[var(--border-strong)] text-[var(--text-primary)]"
          : "bg-transparent border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-default)]",
        dragOver && "border-[var(--text-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
      )}
    >
      {label}
      {onDelete && (
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover/pill:opacity-100 hover:text-red-400 transition-opacity"
        >
          ✕
        </span>
      )}
    </button>
  );
}

// ── Mini canvas preview ───────────────────────────────────────────────────────
// Projects canvas elements into a virtual 16×9 coordinate space expressed as
// CSS percentages — no JavaScript measurement needed, fully responsive.
// canvasData is pre-trimmed server-side (capCanvasForPreview) so boards with
// 100+ images don't spawn that many <img> tags just for a thumbnail.

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
                decoding="async"
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
  dragging,
  dragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  moodboard: MoodboardData;
  onDelete: (id: string) => void;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const router = useRouter();
  const imageCount = moodboard.imageCount ?? moodboard.canvasData.filter((el) => el.type === "image").length;
  const updatedAt = new Date(moodboard.updatedAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      className={cn(
        "group relative rounded-lg border overflow-hidden bg-[var(--bg-elevated)] cursor-grab active:cursor-grabbing hover:border-[var(--border-default)] transition-colors",
        dragging ? "opacity-40 border-[var(--border-subtle)]" : "border-[var(--border-subtle)]",
        dragOver && !dragging && "border-[var(--text-primary)] ring-1 ring-[var(--text-primary)]"
      )}
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
