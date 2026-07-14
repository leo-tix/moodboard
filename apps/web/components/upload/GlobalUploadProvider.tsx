"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { X, Check, Pencil, Upload } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { MetadataPanel } from "@/components/inspiration/MetadataPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueuedFile {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
  inspirationId?: string;
  error?: string;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const GlobalUploadContext = createContext<Record<string, never>>({});
export const useGlobalUpload = () => useContext(GlobalUploadContext);

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_SIZE_MB = 10;

function isValidImage(file: File) {
  return ACCEPTED.includes(file.type) && file.size <= MAX_SIZE_MB * 1024 * 1024;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function GlobalUploadProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isUploadPage = pathname === "/upload";
  const isMoodboardEditor = pathname.startsWith("/moodboards/") && pathname.includes("/edit");

  // ── File queue ──
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);

  // ── Drag detection ──
  const [isDragActive, setIsDragActive] = useState(false);
  const dragCounter = useRef(0);

  // ── Per-file slide-over ──
  const [editingInspirationId, setEditingInspirationId] = useState<string | null>(null);

  // ── Portal mount guard ──
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Enqueue helper ────────────────────────────────────────────────────────

  const enqueue = useCallback((rawFiles: File[]) => {
    const valid = rawFiles.filter(isValidImage);
    if (!valid.length) return;
    setFiles((prev) => [
      ...prev,
      ...valid.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        preview: URL.createObjectURL(f),
        status: "pending" as const,
      })),
    ]);
  }, []);

  // ── Document / window event listeners ────────────────────────────────────

  useEffect(() => {
    if (isUploadPage || isMoodboardEditor) return;

    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      if (e.dataTransfer?.types.includes("application/moodboard-item")) return;
      e.preventDefault();
      dragCounter.current++;
      setIsDragActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      dragCounter.current--;
      if (dragCounter.current <= 0 || e.relatedTarget === null) {
        dragCounter.current = 0;
        setIsDragActive(false);
      }
    };

    const onDragOver = (e: DragEvent) => { e.preventDefault(); };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragActive(false);
      if (e.dataTransfer?.types.includes("application/moodboard-item")) return;
      if (e.dataTransfer?.files.length) {
        enqueue(Array.from(e.dataTransfer.files));
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length) {
        e.preventDefault();
        enqueue(imageFiles);
      }
    };

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);

    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [isUploadPage, isMoodboardEditor, enqueue]);

  // ── Upload ────────────────────────────────────────────────────────────────

  const uploadAll = useCallback(async () => {
    const pending = files.filter((f) => f.status === "pending");
    if (!pending.length || uploading) return;
    setUploading(true);

    await Promise.allSettled(
      pending.map(async (item) => {
        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: "uploading" } : f))
        );
        try {
          const formData = new FormData();
          formData.append("file", item.file);
          const res = await fetch("/api/upload/image", { method: "POST", body: formData });
          const data = await res.json();

          if (!res.ok) {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === item.id
                  ? { ...f, status: "error", error: data.error ?? "Erreur" }
                  : f
              )
            );
            return null;
          }

          const inspirationId: string = data.inspirationId;
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id ? { ...f, status: "done", inspirationId } : f
            )
          );
        } catch {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id ? { ...f, status: "error", error: "Erreur réseau" } : f
            )
          );
        }
      })
    );

    setUploading(false);
  }, [files, uploading]);

  // ── Dismiss ───────────────────────────────────────────────────────────────

  const dismiss = useCallback(() => {
    setFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.preview));
      return [];
    });
    setEditingInspirationId(null);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const pendingCount   = files.filter((f) => f.status === "pending").length;
  const doneCount      = files.filter((f) => f.status === "done").length;
  const errorCount     = files.filter((f) => f.status === "error").length;

  /** Tous les uploads sont terminés */
  const uploadsComplete = files.length > 0 && pendingCount === 0 && !uploading;
  const allSettled = uploadsComplete;

  const editingFile = editingInspirationId
    ? files.find((f) => f.inspirationId === editingInspirationId)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <GlobalUploadContext.Provider value={{}}>
      {children}

      {mounted &&
        createPortal(
          <>
            {/* ── Full-screen drag overlay ───────────────────────────────── */}
            <AnimatePresence>
              {isDragActive && (
                <motion.div
                  key="drag-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="fixed inset-0 z-[9998] pointer-events-none"
                >
                  <div className="absolute inset-0 bg-[var(--bg-base)]/85 backdrop-blur-md" />
                  <motion.div
                    initial={{ scale: 0.97, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="absolute inset-5 rounded-3xl border-2 border-dashed border-[var(--accent,#a78bfa)]/50"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                    <motion.div
                      initial={{ y: 8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.06 }}
                    >
                      <div className="mb-4 opacity-20 flex justify-center"><Upload size={44} strokeWidth={1.5} /></div>
                      <p className="text-[var(--text-primary)] text-2xl font-light tracking-tight">
                        Déposez pour importer
                      </p>
                      <p className="text-[var(--text-tertiary)] text-sm mt-2">
                        JPG, PNG, WebP, GIF, AVIF — max {MAX_SIZE_MB} MB
                      </p>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Floating upload panel ──────────────────────────────────── */}
            <AnimatePresence>
              {files.length > 0 && !isMoodboardEditor && (
                <motion.div
                  key="upload-panel"
                  initial={{ y: 24, opacity: 0, scale: 0.97 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 24, opacity: 0, scale: 0.97 }}
                  transition={{ type: "spring", bounce: 0.18, duration: 0.4 }}
                  className="fixed bottom-[72px] md:bottom-5 left-1/2 -translate-x-1/2 z-[9997] w-full max-w-[440px] px-4"
                >
                  <div className="bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 pt-4 pb-3">
                      <p className="text-xs font-medium text-[var(--text-primary)]">
                        {uploading
                          ? `Import en cours… (${doneCount + errorCount}/${files.length})`
                          : allSettled
                          ? [
                              doneCount > 0 && `${doneCount} importée${doneCount > 1 ? "s" : ""}`,
                              errorCount > 0 && `${errorCount} erreur${errorCount > 1 ? "s" : ""}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : `${files.length} image${files.length > 1 ? "s" : ""} prête${files.length > 1 ? "s" : ""}`}
                      </p>
                      <button
                        onClick={dismiss}
                        className="w-6 h-6 rounded-full bg-[var(--bg-surface)] hover:bg-[var(--bg-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center justify-center transition-colors"
                      >
                        <X size={13} strokeWidth={2} />
                      </button>
                    </div>

                    {/* Thumbnail grid */}
                    <div className="px-4">
                      <div className="flex flex-wrap gap-1.5">
                        {files.map((f) => (
                          <div
                            key={f.id}
                            className={cn(
                              "relative w-12 h-12 rounded-lg overflow-hidden bg-[var(--bg-surface)] flex-shrink-0 group",
                              f.status === "done" && f.inspirationId && "cursor-pointer"
                            )}
                            onClick={() => {
                              if (f.status === "done" && f.inspirationId) {
                                setEditingInspirationId(f.inspirationId);
                              }
                            }}
                            title={f.status === "done" ? "Cliquer pour éditer les métadonnées" : undefined}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={f.preview} alt="" className="w-full h-full object-cover" />

                            {/* Uploading */}
                            {f.status === "uploading" && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <div className="w-4 h-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                              </div>
                            )}

                            {/* Done */}
                            {f.status === "done" && (
                              <>
                                {/* Status badge */}
                                <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-green-500/80 text-white">
                                  <Check size={10} strokeWidth={3} />
                                </div>
                                {/* Edit hover */}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
                                  <span className="text-white opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity flex">
                                    <Pencil size={12} strokeWidth={1.75} />
                                  </span>
                                </div>
                              </>
                            )}

                            {/* Error */}
                            {f.status === "error" && (
                              <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center">
                                <span className="text-red-300 text-[10px] font-bold">!</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Edit hint when done */}
                      {allSettled && doneCount > 0 && (
                        <p className="text-[9px] text-[var(--text-tertiary)] mt-2">
                          Clique sur une image pour éditer ses métadonnées
                        </p>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 px-4 py-3 mt-1">
                      {/* Triage → dès que les uploads sont finis */}
                      {uploadsComplete && (
                        <Link
                          href="/triage"
                          className="text-xs px-4 py-1.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-lg hover:opacity-90 transition-opacity"
                        >
                          Voir le triage →
                        </Link>
                      )}

                      {/* Bouton Importer — quand des fichiers attendent */}
                      {!uploadsComplete && pendingCount > 0 && !uploading && (
                        <button
                          onClick={uploadAll}
                          className="text-xs px-4 py-1.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-lg hover:opacity-90 transition-opacity"
                        >
                          {`Importer ${pendingCount > 1 ? `${pendingCount} images` : "1 image"}`}
                        </button>
                      )}

                      {/* Spinner upload */}
                      {uploading && (
                        <span className="text-xs text-[var(--text-tertiary)] flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border-2 border-[var(--text-tertiary)] border-t-transparent animate-spin inline-block" />
                          Import en cours…
                        </span>
                      )}
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Per-file metadata slide-over ────────────────────────── */}
            <AnimatePresence>
              {editingInspirationId && editingFile && (
                <>
                  {/* Backdrop */}
                  <motion.div
                    key="backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/50 z-[9998]"
                    onClick={() => setEditingInspirationId(null)}
                  />

                  {/* Slide-over panel */}
                  <motion.div
                    key="slideover"
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={{ type: "spring", bounce: 0, duration: 0.32 }}
                    className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-[var(--bg-base)] border-l border-[var(--border-subtle)] z-[9999] flex flex-col"
                  >
                    {/* Slide-over header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] flex-shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-xs text-[var(--text-secondary)] truncate max-w-[280px]">
                          {editingFile.file.name}
                        </p>
                      </div>
                      <button
                        onClick={() => setEditingInspirationId(null)}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ml-2 inline-flex items-center"
                      >
                        <X size={14} strokeWidth={2} />
                      </button>
                    </div>

                    {/* Preview */}
                    <div className="h-48 bg-[var(--bg-surface)] flex-shrink-0 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={editingFile.preview}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                    </div>

                    {/* MetadataPanel */}
                    <div className="flex-1 overflow-hidden">
                      <MetadataPanel
                        id={editingInspirationId}
                        initialData={{
                          title: editingFile.file.name.replace(/\.[^/.]+$/, ""),
                          description: "",
                          author: "",
                          country: "",
                          sourceUrl: "",
                          tags: [],
                          categories: [],
                        }}
                      />
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </>,
          document.body
        )}
    </GlobalUploadContext.Provider>
  );
}
