"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, type PanInfo } from "framer-motion";
import type { MoodboardData, MoodboardFolderData, CanvasElement } from "@/lib/moodboard/types";
import { getImageUrl, getThumbnailUrl } from "@/lib/storage/urls";
import { cn } from "@/lib/utils";
import { useDragHandle } from "@/hooks/useDragHandle";
import { DragHandle } from "@/components/ui/DragHandle";

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
  const draggedIdRef = useRef<string | null>(null);
  draggedIdRef.current = draggedId;

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

  const moveToFolder = (boardId: string, folderId: string | null) => {
    const board = moodboards.find((m) => m.id === boardId);
    if (!board || board.folderId === folderId) return;
    setMoodboards((prev) => prev.map((m) => (m.id === boardId ? { ...m, folderId } : m)));
    persistReorder([{ id: boardId, order: board.order, folderId }]);
  };

  // ── Drag Framer Motion (souris n'importe où, tactile via poignée — voir
  // useDragHandle) — hit-testing par coordonnées (elementFromPoint), pas par
  // les événements HTML5 dragover/drop natifs qui ne fonctionnent pas au
  // tactile. Même pattern que la bibliothèque (InspirationCard/LibraryDropZone).
  const resolveDropTarget = (x: number, y: number): { kind: "card" | "folder"; key: string } | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-key]");
    const key = el?.getAttribute("data-drop-key");
    if (!key) return null;
    if (key.startsWith("card-")) return { kind: "card", key: key.slice(5) };
    if (key.startsWith("folder-")) return { kind: "folder", key: key.slice(7) };
    return null;
  };

  const handleCardDragStart = (id: string) => setDraggedId(id);

  const handleCardDrag = (x: number, y: number) => {
    const target = resolveDropTarget(x, y);
    if (target?.kind === "card" && target.key !== draggedIdRef.current) {
      setDragOverId(target.key);
      setDragOverFolder(null);
    } else if (target?.kind === "folder") {
      setDragOverFolder(target.key === "none" ? "none" : target.key);
      setDragOverId(null);
    } else {
      setDragOverId(null);
      setDragOverFolder(null);
    }
  };

  const handleCardDragEnd = (x: number, y: number) => {
    const target = resolveDropTarget(x, y);
    const id = draggedIdRef.current;
    setDraggedId(null);
    setDragOverId(null);
    setDragOverFolder(null);
    if (!id) return;
    if (target?.kind === "folder") {
      moveToFolder(id, target.key === "none" ? null : target.key);
    } else if (target?.kind === "card" && target.key !== id) {
      handleDropOnCard(target.key);
    }
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
          dropKey="folder-none"
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
              dropKey={`folder-${f.id}`}
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
              folders={folders}
              onDelete={handleDelete}
              onMoveToFolder={moveToFolder}
              dragOver={dragOverId === m.id}
              onCardDragStart={() => handleCardDragStart(m.id)}
              onCardDrag={handleCardDrag}
              onCardDragEnd={handleCardDragEnd}
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
  dropKey,
  dragOver,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onDelete?: () => void;
  /** Identifiant de cible pour le hit-test au drag (voir MoodboardGrid.resolveDropTarget) */
  dropKey?: string;
  dragOver?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      data-drop-key={dropKey}
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
          className="opacity-0 group-hover/pill:opacity-100 pointer-coarse:opacity-100 hover:text-red-400 transition-opacity"
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
  folders,
  onDelete,
  onMoveToFolder,
  dragOver,
  onCardDragStart,
  onCardDrag,
  onCardDragEnd,
}: {
  moodboard: MoodboardData;
  folders: MoodboardFolderData[];
  onDelete: (id: string) => void;
  onMoveToFolder: (id: string, folderId: string | null) => void;
  dragOver: boolean;
  onCardDragStart: () => void;
  onCardDrag: (x: number, y: number) => void;
  onCardDragEnd: (x: number, y: number) => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const imageCount = moodboard.imageCount ?? moodboard.canvasData.filter((el) => el.type === "image").length;
  const updatedAt = new Date(moodboard.updatedAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric",
  });

  const { dragProps, onCardPointerDown, handleProps } = useDragHandle(true);
  // Évite qu'un clic déclenché juste après un vrai drag ne navigue par accident.
  const justDraggedRef = useRef(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [menuOpen]);

  return (
    <motion.div
      data-drop-key={`card-${moodboard.id}`}
      {...dragProps}
      onPointerDown={onCardPointerDown}
      onDragStart={() => { justDraggedRef.current = true; onCardDragStart(); }}
      onDrag={(_e, info: PanInfo) => onCardDrag(info.point.x, info.point.y)}
      onDragEnd={(_e, info: PanInfo) => {
        onCardDragEnd(info.point.x, info.point.y);
        setTimeout(() => { justDraggedRef.current = false; }, 150);
      }}
      className={cn(
        "group relative rounded-lg border overflow-hidden bg-[var(--bg-elevated)] cursor-grab active:cursor-grabbing hover:border-[var(--border-default)] transition-colors",
        "border-[var(--border-subtle)]",
        dragOver && "border-[var(--text-primary)] ring-1 ring-[var(--text-primary)]"
      )}
      onClick={() => { if (!justDraggedRef.current) router.push(`/moodboards/${moodboard.id}/edit`); }}
    >
      {/* Live canvas preview */}
      <MoodboardPreview canvasData={moodboard.canvasData} background={moodboard.background} />

      {/* Poignée de drag — tactile uniquement (souris : saisir n'importe où) */}
      <DragHandle {...handleProps} className="absolute bottom-2 right-2 z-20" title="Glisser vers un dossier ou pour réordonner" />

      {/* Info */}
      <div className="px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-[var(--text-primary)] truncate">{moodboard.title}</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
            {updatedAt} · {imageCount} image{imageCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center flex-shrink-0">
          {/* Menu ⋯ — alternative au drag pour classer/supprimer, toujours
              accessible même si on préfère ne pas glisser. */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 w-6 h-6 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all text-sm"
              title="Options"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 bottom-full mb-1 z-50 w-44 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="px-3 pt-2 pb-1 text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest">
                  Déplacer dans
                </p>
                <div className="max-h-40 overflow-y-auto">
                  <button
                    onClick={() => { onMoveToFolder(moodboard.id, null); setMenuOpen(false); }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-[11px] transition-colors",
                      !moodboard.folderId
                        ? "text-[var(--text-primary)] bg-[var(--bg-surface)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                    )}
                  >
                    Sans dossier
                  </button>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => { onMoveToFolder(moodboard.id, f.id); setMenuOpen(false); }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-[11px] transition-colors truncate",
                        moodboard.folderId === f.id
                          ? "text-[var(--text-primary)] bg-[var(--bg-surface)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                      )}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(moodboard.id); }}
                  className="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] transition-colors"
                >
                  Supprimer la planche
                </button>
              </div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(moodboard.id); }}
            className="opacity-0 group-hover:opacity-100 w-6 h-6 hidden md:flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 transition-all text-xs"
            title="Supprimer"
          >
            ✕
          </button>
        </div>
      </div>
    </motion.div>
  );
}
