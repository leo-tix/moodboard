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
  /** "quota" = rate-limit hit (distinct from generic "error") */
  aiStatus?: "analyzing" | "done" | "error" | "quota";
  retryAfter?: number;
  aiData?: {
    title?: string;
    description?: string;
    notes?: string;
    tags?: string[];
    categories?: { categoryId: string; subcategoryId: null }[];
  };
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

  // ── AI toggle ──
  const [aiEnabled, setAiEnabled] = useState(false);

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

  // ── AI: analyze + auto-apply ──────────────────────────────────────────────

  const analyzeAndApply = useCallback(async (inspirationId: string, fileId: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, aiStatus: "analyzing" } : f))
    );
    try {
      const res = await fetch(`/api/inspirations/${inspirationId}/analyze`, { method: "POST" });

      // Rate-limit: distinct visual state, not a generic error
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, aiStatus: "quota", retryAfter: data.retryAfter ?? 60 }
              : f
          )
        );
        return;
      }

      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();

      const patch: Record<string, unknown> = {};
      if (data.analysis?.suggestedTitle) patch.title = data.analysis.suggestedTitle;
      if (data.analysis?.moodDescriptor) patch.description = data.analysis.moodDescriptor;
      if (data.analysis?.technicalNotes) patch.notes = data.analysis.technicalNotes;
      if (data.suggestedTags?.length) patch.tags = data.suggestedTags;
      if (data.suggestedCategories?.length) {
        patch.categories = data.suggestedCategories.map((c: { id: string }) => ({
          categoryId: c.id,
          subcategoryId: null,
        }));
      }

      if (Object.keys(patch).length > 0) {
        const patchRes = await fetch(`/api/inspirations/${inspirationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!patchRes.ok) {
          const errBody = await patchRes.json().catch(() => ({}));
          console.error("[GlobalUpload] PATCH inspiration échoué :", patchRes.status, errBody);
        }
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                aiStatus: "done",
                aiData: {
                  title: data.analysis?.suggestedTitle,
                  description: data.analysis?.moodDescriptor,
                  notes: data.analysis?.technicalNotes,
                  tags: data.suggestedTags ?? [],
                  categories: (data.suggestedCategories ?? []).map((c: { id: string }) => ({
                    categoryId: c.id,
                    subcategoryId: null as null,
                  })),
                },
              }
            : f
        )
      );
    } catch {
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, aiStatus: "error" } : f))
      );
    }
  }, []);

  // ── Upload ────────────────────────────────────────────────────────────────

  const uploadAll = useCallback(async () => {
    const pending = files.filter((f) => f.status === "pending");
    if (!pending.length || uploading) return;
    setUploading(true);

    const shouldAnalyze = aiEnabled;

    // ── Phase 1 : uploads en parallèle ───────────────────────────────────
    const results = await Promise.allSettled(
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
          return { fileId: item.id, inspirationId };
        } catch {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id ? { ...f, status: "error", error: "Erreur réseau" } : f
            )
          );
          return null;
        }
      })
    );

    // Les uploads sont terminés — l'UI peut afficher "Bibliothèque →" dès maintenant
    setUploading(false);

    // ── Phase 2 : analyses séquentielles en tâche de fond ────────────────
    if (shouldAnalyze) {
      const uploaded = results
        .filter(
          (r): r is PromiseFulfilledResult<{ fileId: string; inspirationId: string } | null> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value)
        .filter((v): v is { fileId: string; inspirationId: string } => v !== null);

      // void : on ne bloque pas — les mises à jour d'état arrivent au fil de l'eau
      // Try/catch individuel : une erreur sur un fichier ne bloque pas les suivants
      void (async () => {
        for (const item of uploaded) {
          try {
            await analyzeAndApply(item.inspirationId, item.fileId);
          } catch (err) {
            console.error("[GlobalUpload] analyzeAndApply inattendu :", err);
          }
        }
      })();
    }
  }, [files, uploading, aiEnabled, analyzeAndApply]);

  // ── Retry quota-failed analyses ───────────────────────────────────────────

  const retryQuotaFiles = useCallback(async () => {
    const quotaFiles = files.filter(
      (f) => f.aiStatus === "quota" && f.inspirationId
    );
    for (const f of quotaFiles) {
      await analyzeAndApply(f.inspirationId!, f.id);
    }
  }, [files, analyzeAndApply]);

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
  const analyzingCount = files.filter((f) => f.aiStatus === "analyzing").length;
  const aiDoneCount    = files.filter((f) => f.aiStatus === "done").length;
  const quotaCount     = files.filter((f) => f.aiStatus === "quota").length;

  /** Tous les uploads sont terminés (analyses éventuellement encore en cours) */
  const uploadsComplete = files.length > 0 && pendingCount === 0 && !uploading;
  /** Tout est terminé, y compris les analyses */
  const allSettled = uploadsComplete && analyzingCount === 0;

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
                      <div className="text-5xl mb-4 opacity-20">↑</div>
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
                          : uploadsComplete && analyzingCount > 0
                          ? `✦ Analyse ${aiDoneCount + quotaCount + files.filter(f => f.aiStatus === "error").length}/${doneCount}…`
                          : allSettled
                          ? [
                              doneCount > 0 && `${doneCount} importée${doneCount > 1 ? "s" : ""}`,
                              aiDoneCount > 0 && `${aiDoneCount} analysée${aiDoneCount > 1 ? "s" : ""}`,
                              quotaCount > 0 && `${quotaCount} quota`,
                              errorCount > 0 && `${errorCount} erreur${errorCount > 1 ? "s" : ""}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : `${files.length} image${files.length > 1 ? "s" : ""} prête${files.length > 1 ? "s" : ""}`}
                      </p>
                      <button
                        onClick={dismiss}
                        className="w-6 h-6 rounded-full bg-[var(--bg-surface)] hover:bg-[var(--bg-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center justify-center text-[10px] transition-colors"
                      >
                        ✕
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

                            {/* AI analyzing */}
                            {f.aiStatus === "analyzing" && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <div className="flex flex-col items-center gap-1">
                                  <div className="w-3 h-3 rounded-full border-2 border-[var(--accent,#a78bfa)] border-t-transparent animate-spin" />
                                  <span className="text-[7px] text-[var(--accent,#a78bfa)]">✦</span>
                                </div>
                              </div>
                            )}

                            {/* Done */}
                            {f.status === "done" && f.aiStatus !== "analyzing" && (
                              <>
                                {/* Status badge */}
                                <div
                                  className={cn(
                                    "absolute top-0.5 left-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px]",
                                    f.aiStatus === "done"
                                      ? "bg-[var(--accent,#a78bfa)]/80 text-white"
                                      : f.aiStatus === "error"
                                      ? "bg-orange-500/80 text-white"
                                      : f.aiStatus === "quota"
                                      ? "bg-yellow-500/80 text-white"
                                      : "bg-green-500/80 text-white"
                                  )}
                                  title={
                                    f.aiStatus === "quota"
                                      ? "Quota Gemini dépassé — cliquer pour réessayer"
                                      : undefined
                                  }
                                >
                                  {f.aiStatus === "done"
                                    ? "✦"
                                    : f.aiStatus === "error"
                                    ? "!"
                                    : f.aiStatus === "quota"
                                    ? "⏳"
                                    : "✓"}
                                </div>
                                {/* Edit hover */}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
                                  <span className="text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                                    ✎
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

                    {/* ── AI toggle (only shown when files are pending) ── */}
                    {!uploading && !allSettled && (
                      <div className="px-4 pt-3">
                        <div
                          className={cn(
                            "flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-colors",
                            aiEnabled
                              ? "border-[var(--accent,#a78bfa)]/30 bg-[var(--accent,#a78bfa)]/5"
                              : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                          )}
                        >
                          {/* Toggle */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={aiEnabled}
                            onClick={() => setAiEnabled((v) => !v)}
                            className={cn(
                              "relative mt-0.5 inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
                              aiEnabled ? "bg-[var(--accent,#a78bfa)]" : "bg-[var(--bg-overlay)]"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                                aiEnabled ? "translate-x-3" : "translate-x-0"
                              )}
                            />
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "text-[10px] font-medium",
                                  aiEnabled
                                    ? "text-[var(--accent,#a78bfa)]"
                                    : "text-[var(--text-secondary)]"
                                )}
                              >
                                ✦ Analyse IA automatique
                              </span>
                              <span
                                className={cn(
                                  "text-[8px] px-1 py-0.5 rounded-full",
                                  aiEnabled
                                    ? "bg-[var(--accent,#a78bfa)]/20 text-[var(--accent,#a78bfa)]"
                                    : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
                                )}
                              >
                                {aiEnabled ? "ON" : "OFF"}
                              </span>
                            </div>
                            <p className="text-[9px] text-[var(--text-tertiary)] leading-relaxed mt-0.5">
                              {aiEnabled ? (
                                <>
                                  <span className="text-[var(--accent,#a78bfa)]/80">
                                    Titre, description, tags et catégories appliqués automatiquement.{" "}
                                  </span>
                                  Vignette 256 px envoyée à Google Gemini (hors UE).
                                </>
                              ) : (
                                <>
                                  Activer pour que Gemini remplisse titre, tags et catégories
                                  automatiquement. Données transmises à Google (hors UE).
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 px-4 py-3 mt-1">
                      {/* Bouton Réanalyser — visible seulement quand tout est terminé */}
                      {allSettled && quotaCount > 0 && (
                        <button
                          onClick={retryQuotaFiles}
                          className="text-xs px-3 py-1.5 border border-yellow-500/40 text-yellow-400 rounded-lg hover:bg-yellow-500/10 transition-colors"
                          title="Quota Gemini dépassé. Cliquer pour réessayer."
                        >
                          ⏳ Réanalyser {quotaCount > 1 ? `${quotaCount} images` : "1 image"}
                        </button>
                      )}

                      {/* Bibliothèque → dès que les uploads sont finis */}
                      {uploadsComplete && (
                        <Link
                          href="/library"
                          className="text-xs px-4 py-1.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-lg hover:opacity-90 transition-opacity"
                        >
                          {analyzingCount > 0 ? "Bibliothèque (analyse en cours…)" : "Voir la bibliothèque →"}
                        </Link>
                      )}

                      {/* Bouton Importer — quand des fichiers attendent */}
                      {!uploadsComplete && pendingCount > 0 && !uploading && (
                        <button
                          onClick={uploadAll}
                          className="text-xs px-4 py-1.5 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-lg hover:opacity-90 transition-opacity"
                        >
                          {aiEnabled
                            ? `Importer + analyser ${pendingCount > 1 ? `${pendingCount} images` : "1 image"}`
                            : `Importer ${pendingCount > 1 ? `${pendingCount} images` : "1 image"}`}
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
                        {editingFile.aiStatus === "done" && (
                          <span className="text-[9px] text-[var(--accent,#a78bfa)] flex-shrink-0">
                            ✦ Analysée
                          </span>
                        )}
                        {editingFile.aiStatus === "error" && (
                          <span className="text-[9px] text-orange-400 flex-shrink-0">
                            ⚠ Analyse échouée
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setEditingInspirationId(null)}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ml-2"
                      >
                        ✕
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
                          title:
                            editingFile.aiData?.title ??
                            editingFile.file.name.replace(/\.[^/.]+$/, ""),
                          description: editingFile.aiData?.description ?? "",
                          author: "",
                          studio: "",
                          country: "",
                          notes: editingFile.aiData?.notes ?? "",
                          sourceUrl: "",
                          tags: editingFile.aiData?.tags ?? [],
                          categories: editingFile.aiData?.categories ?? [],
                        }}
                        aiFirst={
                          editingFile.aiStatus === "done" ||
                          editingFile.aiStatus === "error"
                        }
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
