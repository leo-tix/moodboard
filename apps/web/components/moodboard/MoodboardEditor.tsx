"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Rnd } from "react-rnd";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { getImageUrl } from "@/lib/storage/urls";
import type { MoodboardData, CanvasElement, ImageElement, TextElement, ColorElement } from "@/lib/moodboard/types";
import { LibraryPanel } from "@/components/moodboard/LibraryPanel";
import { SharePanel } from "@/components/moodboard/SharePanel";
import { AI_IMPORT_KEY } from "@/components/settings/GeneralSettings";

interface Props {
  initialData: MoodboardData;
}

let nextZ = 100;

function makeId() {
  return Math.random().toString(36).slice(2);
}

export function MoodboardEditor({ initialData }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialData.title);
  const [background, setBackground] = useState(initialData.background);
  const [elements, setElements] = useState<CanvasElement[]>(initialData.canvasData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareToken, setShareToken] = useState(initialData.shareToken);
  const [shareExpiry, setShareExpiry] = useState(initialData.shareExpiry);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const aiOnImport = useRef(false);

  useEffect(() => {
    aiOnImport.current = localStorage.getItem(AI_IMPORT_KEY) === "true";
  }, []);

  // ── Auto-save debounced ──
  const save = useCallback(async (data: { title?: string; canvasData?: CanvasElement[]; background?: string }) => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/moodboards/${initialData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [initialData.id]);

  const scheduleSave = useCallback((data: Parameters<typeof save>[0]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(data), 1000);
  }, [save]);

  const updateElements = useCallback((updater: (prev: CanvasElement[]) => CanvasElement[]) => {
    setElements((prev) => {
      const next = updater(prev);
      scheduleSave({ canvasData: next });
      setSaved(false);
      return next;
    });
  }, [scheduleSave]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        updateElements((prev) => prev.filter((el) => el.id !== selectedId));
        setSelectedId(null);
      }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, updateElements]);

  // ── Add element helpers ──
  const addImage = useCallback((item: { inspirationId: string; storageKey: string; title: string }) => {
    const el: ImageElement = {
      id: makeId(), type: "image",
      x: 80 + Math.random() * 120, y: 80 + Math.random() * 80,
      w: 320, h: 220,
      zIndex: ++nextZ,
      ...item,
    };
    updateElements((prev) => [...prev, el]);
  }, [updateElements]);

  const addText = useCallback(() => {
    const el: TextElement = {
      id: makeId(), type: "text",
      x: 100 + Math.random() * 200, y: 100 + Math.random() * 100,
      w: 240, h: 60,
      zIndex: ++nextZ,
      content: "Texte libre",
      fontSize: 18,
      color: "#ffffff",
      bold: false,
      italic: false,
    };
    updateElements((prev) => [...prev, el]);
  }, [updateElements]);

  const addColor = useCallback(() => {
    const el: ColorElement = {
      id: makeId(), type: "color",
      x: 120 + Math.random() * 200, y: 120 + Math.random() * 100,
      w: 160, h: 100,
      zIndex: ++nextZ,
      color: "#3b4bdb",
    };
    updateElements((prev) => [...prev, el]);
  }, [updateElements]);

  // ── Drop position relative to canvas ──
  const getDropPos = useCallback((e: React.DragEvent, w: number, h: number) => {
    if (!canvasRef.current) return { x: 80, y: 80 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(e.clientX - rect.left - w / 2)),
      y: Math.max(0, Math.round(e.clientY - rect.top - h / 2)),
    };
  }, []);

  // ── Drop: library item ──
  const handleLibraryDrop = useCallback((e: React.DragEvent) => {
    const raw = e.dataTransfer.getData("application/moodboard-item");
    if (!raw) return false;
    const item = JSON.parse(raw) as { inspirationId: string; storageKey: string; title: string };
    const { x, y } = getDropPos(e, 320, 220);
    const el: ImageElement = { id: makeId(), type: "image", x, y, w: 320, h: 220, zIndex: ++nextZ, ...item };
    updateElements((prev) => [...prev, el]);
    return true;
  }, [getDropPos, updateElements]);

  // ── Upload un fichier image → bibliothèque + canvas + IA optionnelle ──
  const uploadFile = useCallback(async (file: File, x: number, y: number, offsetIdx = 0) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload/image", { method: "POST", body: fd });
    if (!res.ok) return;
    const data = await res.json() as { inspirationId: string; image: { storageKey: string } };
    const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    const el: ImageElement = {
      id: makeId(), type: "image",
      x: x + offsetIdx * 24, y: y + offsetIdx * 24,
      w: 320, h: 220,
      zIndex: ++nextZ,
      inspirationId: data.inspirationId,
      storageKey: data.image.storageKey,
      title,
    };
    updateElements((prev) => [...prev, el]);
    if (aiOnImport.current) {
      fetch(`/api/inspirations/${data.inspirationId}/analyze`, { method: "POST" }).catch(() => {});
    }
  }, [updateElements]);

  // ── Paste Ctrl+V : images → upload direct dans le canvas ──
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).isContentEditable) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageFiles = items
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (imageFiles.length === 0) return;
      e.preventDefault();
      setUploading(true);
      try {
        await Promise.all(imageFiles.map((file, i) => uploadFile(file, 80 + i * 24, 80 + i * 24, 0)));
      } finally {
        setUploading(false);
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [uploadFile]);

  // ── Drop: external image files ──
  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    setUploading(true);
    const { x, y } = getDropPos(e, 320, 220);
    try {
      await Promise.all(files.map((file, i) => uploadFile(file, x, y, i)));
    } finally {
      setUploading(false);
    }
  }, [getDropPos, uploadFile]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (handleLibraryDrop(e)) return;
    await handleFileDrop(e);
  }, [handleLibraryDrop, handleFileDrop]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }, []);

  const bringToFront = useCallback((id: string) => {
    updateElements((prev) =>
      prev.map((el) => el.id === id ? { ...el, zIndex: ++nextZ } : el)
    );
  }, [updateElements]);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    scheduleSave({ title: v });
    setSaved(false);
  };

  const handleBackgroundChange = (v: string) => {
    setBackground(v);
    scheduleSave({ background: v });
    setSaved(false);
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-base)] overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 h-11 border-b border-[var(--border-subtle)] flex items-center gap-2 px-4">
        <button
          onClick={() => router.push("/moodboards")}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
        >
          ← Planches
        </button>

        <span className="text-[var(--border-default)] text-xs">|</span>

        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          placeholder="Sans titre"
        />

        <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
          {uploading ? "Upload…" : saving ? "Sauvegarde…" : saved ? "Sauvegardé" : "…"}
        </span>

        <div className="w-px h-4 bg-[var(--border-subtle)]" />

        {/* Fond */}
        <div className="flex items-center gap-1.5 flex-shrink-0" title="Couleur de fond">
          <label className="relative cursor-pointer">
            <span
              className="block w-5 h-5 rounded border border-[var(--border-default)]"
              style={{ backgroundColor: background }}
            />
            <input
              type="color"
              value={background}
              onChange={(e) => handleBackgroundChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </label>
        </div>

        <div className="w-px h-4 bg-[var(--border-subtle)]" />

        {/* Ajouter */}
        <button onClick={addText} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-1 rounded hover:bg-[var(--bg-surface)]" title="Ajouter un bloc texte">T</button>
        <button onClick={addColor} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-1 rounded hover:bg-[var(--bg-surface)]" title="Ajouter un bloc couleur">■</button>
        <button
          onClick={() => setShowLibrary((v) => !v)}
          className={`text-xs transition-colors px-1.5 py-1 rounded ${showLibrary ? "bg-[var(--bg-surface)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"}`}
          title="Bibliothèque d'images"
        >
          ◻ Biblio
        </button>

        <div className="w-px h-4 bg-[var(--border-subtle)]" />

        <button
          onClick={() => setShowShare((v) => !v)}
          className={`text-xs transition-colors px-2 py-1 rounded border ${showShare ? "bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]"}`}
        >
          Partager
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Library panel */}
        {showLibrary && (
          <div className="flex-shrink-0 w-64 border-r border-[var(--border-subtle)] overflow-y-auto bg-[var(--bg-base)]">
            <LibraryPanel onAdd={addImage} />
          </div>
        )}

        {/* Canvas */}
        <div
          className={`flex-1 overflow-auto relative transition-colors ${dragOver ? "bg-[var(--accent,#a78bfa)]/10" : ""}`}
          style={{ backgroundColor: dragOver ? undefined : "var(--bg-surface)" }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
        >
          {/* Drop overlay hint */}
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
              <div className="bg-[var(--bg-elevated)] border-2 border-dashed border-[var(--accent,#a78bfa)] rounded-xl px-8 py-5 text-sm text-[var(--text-secondary)]">
                Déposer ici
              </div>
            </div>
          )}

          {/* Upload spinner */}
          {uploading && (
            <div className="pointer-events-none absolute top-3 right-3 z-50 flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg px-3 py-2 shadow-lg">
              <div className="w-3 h-3 border-2 border-[var(--accent,#a78bfa)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-[var(--text-secondary)]">Upload en cours…</span>
            </div>
          )}

          <div
            ref={canvasRef}
            className="relative"
            style={{ width: 1600, height: 1000, backgroundColor: background, flexShrink: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
          >
            {elements.map((el) => (
              <CanvasItem
                key={el.id}
                element={el}
                selected={selectedId === el.id}
                onSelect={() => { setSelectedId(el.id); bringToFront(el.id); }}
                onChange={(updated) => updateElements((prev) => prev.map((e) => e.id === updated.id ? updated : e))}
                onDelete={() => { updateElements((prev) => prev.filter((e) => e.id !== el.id)); setSelectedId(null); }}
              />
            ))}
          </div>
        </div>

        {/* Share panel */}
        {showShare && (
          <div className="flex-shrink-0 w-72 border-l border-[var(--border-subtle)] overflow-y-auto bg-[var(--bg-base)]">
            <SharePanel
              moodboardId={initialData.id}
              shareToken={shareToken}
              shareExpiry={shareExpiry}
              onUpdate={(token, expiry) => { setShareToken(token); setShareExpiry(expiry); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Canvas element wrapper ────────────────────────────────────────────────────

interface CanvasItemProps {
  element: CanvasElement;
  selected: boolean;
  onSelect: () => void;
  onChange: (el: CanvasElement) => void;
  onDelete: () => void;
}

function CanvasItem({ element, selected, onSelect, onChange, onDelete }: CanvasItemProps) {
  return (
    <Rnd
      position={{ x: element.x, y: element.y }}
      size={{ width: element.w, height: element.h }}
      style={{ zIndex: element.zIndex }}
      onMouseDown={onSelect}
      onDragStop={(_, d) => onChange({ ...element, x: d.x, y: d.y })}
      onResizeStop={(_, __, ref, ___, pos) =>
        onChange({ ...element, x: pos.x, y: pos.y, w: ref.offsetWidth, h: ref.offsetHeight })
      }
      bounds="parent"
      className={`group ${selected ? "outline outline-2 outline-offset-1 outline-[var(--accent,#a78bfa)]" : ""}`}
    >
      <div className="relative w-full h-full select-none">
        <ElementContent element={element} selected={selected} onChange={onChange} />
        {selected && (
          <button
            onMouseDown={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center shadow z-50"
          >
            ✕
          </button>
        )}
      </div>
    </Rnd>
  );
}

function ElementContent({ element, selected, onChange }: { element: CanvasElement; selected: boolean; onChange: (el: CanvasElement) => void }) {
  if (element.type === "image") {
    const url = getImageUrl(element.storageKey);
    return (
      <div className="w-full h-full overflow-hidden rounded-sm">
        <Image src={url} alt={element.title} fill className="object-cover" sizes="400px" draggable={false} />
      </div>
    );
  }

  if (element.type === "text") {
    return (
      <div className="w-full h-full flex items-start p-1">
        <div
          contentEditable={selected}
          suppressContentEditableWarning
          onBlur={(e) => onChange({ ...element, content: e.currentTarget.textContent ?? "" })}
          className="outline-none w-full break-words"
          style={{
            fontSize: element.fontSize,
            color: element.color,
            fontWeight: element.bold ? "bold" : "normal",
            fontStyle: element.italic ? "italic" : "normal",
            lineHeight: 1.3,
          }}
        >
          {element.content}
        </div>
      </div>
    );
  }

  // color
  return <div className="w-full h-full rounded-sm" style={{ backgroundColor: element.color }} />;
}
