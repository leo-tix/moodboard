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
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueuedFile {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
  inspirationId?: string;
  error?: string;
}

// ─── Context (kept minimal — nothing needs to be consumed externally yet) ─────

const GlobalUploadContext = createContext<Record<string, never>>({});
export const useGlobalUpload = () => useContext(GlobalUploadContext);

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_SIZE_MB = 10;

function isValidImage(file: File) {
  return ACCEPTED.includes(file.type) && file.size <= MAX_SIZE_MB * 1024 * 1024;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function GlobalUploadProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // On the /upload page, the DropZone already handles everything — skip global listeners
  const isUploadPage = pathname === "/upload";

  const [isDragActive, setIsDragActive] = useState(false);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Add files helper ──────────────────────────────────────────────────────

  const enqueue = useCallback((rawFiles: File[]) => {
    const valid = rawFiles.filter(isValidImage);
    if (!valid.length) return;

    const queued: QueuedFile[] = valid.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      // Pasted images have a generic name — give them a readable one
      preview: URL.createObjectURL(f),
      status: "pending",
    }));
    setFiles((prev) => [...prev, ...queued]);
  }, []);

  // ── Window / document event listeners ────────────────────────────────────

  useEffect(() => {
    if (isUploadPage) return;

    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragCounter.current++;
      setIsDragActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      dragCounter.current--;
      // relatedTarget === null means we left the browser window entirely
      if (dragCounter.current <= 0 || e.relatedTarget === null) {
        dragCounter.current = 0;
        setIsDragActive(false);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault(); // required to allow drop
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragActive(false);
      if (e.dataTransfer?.files.length) {
        enqueue(Array.from(e.dataTransfer.files));
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;

      // Don't intercept paste inside text fields
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;

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
  }, [isUploadPage, enqueue]);

  // ── Upload logic ──────────────────────────────────────────────────────────

  const uploadAll = useCallback(async () => {
    const pending = files.filter((f) => f.status === "pending");
    if (!pending.length || uploading) return;
    setUploading(true);

    for (const item of pending) {
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
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? { ...f, status: "done", inspirationId: data.inspirationId }
                : f
            )
          );
        }
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id ? { ...f, status: "error", error: "Erreur réseau" } : f
          )
        );
      }
    }

    setUploading(false);
  }, [files, uploading]);

  const dismiss = useCallback(() => {
    setFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.preview));
      return [];
    });
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const allSettled = files.length > 0 && pendingCount === 0 && !uploading;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <GlobalUploadContext.Provider value={{}}>
      {children}

      {mounted &&
        createPortal(
          <>
            {/* ── Full-screen drag overlay ── */}
            <AnimatePresence>
              {isDragActive && (
                <motion.div
                  key="drag-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-[9998] pointer-events-none"
                >
                  {/* Frosted background */}
                  <div className="absolute inset-0 bg-[var(--bg-base)]/85 backdrop-blur-md" />
                  {/* Animated dashed border */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute inset-5 rounded-3xl border-2 border-dashed border-[var(--accent,#a78bfa)]/50"
                  />
                  {/* Label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                    <motion.div
                      initial={{ y: 6, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.05 }}
                    >
                      <div className="text-5xl mb-4 opacity-25">↑</div>
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

            {/* ── Bottom upload tray ── */}
            <AnimatePresence>
              {files.length > 0 && (
                <motion.div
                  key="upload-tray"
                  initial={{ y: 80, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 80, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                  className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9997] w-full max-w-xl px-4"
                >
                  <div className="bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-2xl shadow-2xl shadow-black/40 px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* Thumbnails strip */}
                      <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
                        {files.slice(0, 7).map((f) => (
                          <div
                            key={f.id}
                            className="relative w-9 h-9 rounded-lg overflow-hidden bg-[var(--bg-surface)] flex-shrink-0"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={f.preview}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                            {/* Status overlays */}
                            {f.status === "uploading" && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <div className="w-3 h-3 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                              </div>
                            )}
                            {f.status === "done" && (
                              <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                                <span className="text-green-400 text-[11px] font-bold">✓</span>
                              </div>
                            )}
                            {f.status === "error" && (
                              <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center">
                                <span className="text-red-300 text-[11px] font-bold">!</span>
                              </div>
                            )}
                          </div>
                        ))}
                        {files.length > 7 && (
                          <div className="w-9 h-9 rounded-lg bg-[var(--bg-surface)] flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] text-[var(--text-tertiary)]">
                              +{files.length - 7}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Status label */}
                      <div className="flex-shrink-0 text-xs text-[var(--text-tertiary)] whitespace-nowrap">
                        {uploading && (
                          <span>Import en cours…</span>
                        )}
                        {!uploading && pendingCount > 0 && (
                          <span>
                            {files.length} image{files.length > 1 ? "s" : ""}
                          </span>
                        )}
                        {allSettled && (
                          <span>
                            {doneCount > 0 && (
                              <span className="text-green-400">
                                {doneCount} importée{doneCount > 1 ? "s" : ""}
                              </span>
                            )}
                            {errorCount > 0 && (
                              <span className="text-red-400 ml-1.5">
                                {errorCount} erreur{errorCount > 1 ? "s" : ""}
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {allSettled && doneCount > 0 ? (
                          <a
                            href="/library"
                            className="text-xs px-3 py-1.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-lg hover:opacity-90 transition-opacity"
                          >
                            Bibliothèque →
                          </a>
                        ) : !uploading && pendingCount > 0 ? (
                          <button
                            onClick={uploadAll}
                            className="text-xs px-3 py-1.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-lg hover:opacity-90 transition-opacity"
                          >
                            Importer {pendingCount > 1 ? `${pendingCount} images` : "1 image"}
                          </button>
                        ) : null}

                        {/* Dismiss */}
                        <button
                          onClick={dismiss}
                          title="Fermer"
                          className="w-6 h-6 rounded-full bg-[var(--bg-surface)] hover:bg-[var(--bg-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center justify-center text-[10px] transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Ctrl+V hint — only when tray first appears and nothing uploaded yet */}
                    {pendingCount === files.length && !uploading && files.length === 1 && (
                      <p className="text-[9px] text-[var(--text-tertiary)] mt-2 text-center opacity-60">
                        Ctrl+V pour coller d&apos;autres images depuis le presse-papier
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>,
          document.body
        )}
    </GlobalUploadContext.Provider>
  );
}
