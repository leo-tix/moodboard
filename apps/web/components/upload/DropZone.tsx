"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { CategorySelect } from "@/components/inspiration/CategorySelect";
import { TagInput } from "@/components/inspiration/TagInput";
import { MetadataPanel } from "@/components/inspiration/MetadataPanel";

interface UploadFile {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
  inspirationId?: string;
  error?: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  subcategories: { id: string; name: string; slug: string }[];
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_SIZE_MB = 10;

const fieldClass =
  "w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";
const sectionLabel = "block text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5";

export function DropZone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  // Per-item metadata drawer
  const [editingId, setEditingId] = useState<string | null>(null);

  // Batch metadata for all uploaded
  const [categories, setCategories] = useState<Category[]>([]);
  const [batchCategory, setBatchCategory] = useState({ categoryId: "", subcategoryId: "" });
  const [batchTags, setBatchTags] = useState<string[]>([]);
  const [batchTitle, setBatchTitle] = useState("");
  const [applyingBatch, setApplyingBatch] = useState(false);
  const [batchApplied, setBatchApplied] = useState(false);
  const [analyzingBatch, setAnalyzingBatch] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  // Analyse IA — désactivée par défaut (les images partent chez Google)
  const [aiEnabled, setAiEnabled] = useState(false);

  const doneFiles = files.filter((f) => f.status === "done");
  const doneIds = doneFiles.map((f) => f.inspirationId).filter(Boolean) as string[];

  useEffect(() => {
    if (doneFiles.length > 0 && categories.length === 0) {
      fetch("/api/categories")
        .then((r) => r.json())
        .then(setCategories)
        .catch(console.error);
    }
  }, [doneFiles.length, categories.length]);

  const addFiles = useCallback((rawFiles: File[]) => {
    const valid = rawFiles.filter(
      (f) => ACCEPTED.includes(f.type) && f.size <= MAX_SIZE_MB * 1024 * 1024
    );
    const newFiles: UploadFile[] = valid.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      preview: URL.createObjectURL(f),
      status: "pending",
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.preview);
      return prev.filter((x) => x.id !== id);
    });
  };

  const uploadAll = async () => {
    const pending = files.filter((f) => f.status === "pending");
    if (!pending.length) return;
    setUploading(true);

    for (const item of pending) {
      setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "uploading" } : f)));

      try {
        const formData = new FormData();
        formData.append("file", item.file);
        const res = await fetch("/api/upload/image", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          setFiles((prev) =>
            prev.map((f) => f.id === item.id ? { ...f, status: "error", error: data.error ?? "Erreur" } : f)
          );
          continue;
        }

        setFiles((prev) =>
          prev.map((f) => f.id === item.id ? { ...f, status: "done", inspirationId: data.inspirationId } : f)
        );
      } catch {
        setFiles((prev) =>
          prev.map((f) => f.id === item.id ? { ...f, status: "error", error: "Erreur réseau" } : f)
        );
      }
    }

    setUploading(false);
  };

  const applyBatchMetadata = async () => {
    if (!doneIds.length) return;
    const hasPatch = batchTitle.trim() || batchCategory.categoryId || batchTags.length > 0;
    if (!hasPatch) return;

    setApplyingBatch(true);
    try {
      await fetch("/api/inspirations/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: doneIds,
          patch: {
            ...(batchTitle.trim() ? { title: batchTitle.trim() } : {}),
            ...(batchCategory.categoryId
              ? { addCategory: { categoryId: batchCategory.categoryId, subcategoryId: batchCategory.subcategoryId || null } }
              : {}),
            ...(batchTags.length > 0 ? { addTags: batchTags } : {}),
          },
        }),
      });
      setBatchApplied(true);
      setTimeout(() => setBatchApplied(false), 2500);
    } finally {
      setApplyingBatch(false);
    }
  };

  const analyzeBatch = async () => {
    if (!doneIds.length) return;
    setAnalyzingBatch(true);
    setAnalyzeProgress(0);
    for (let i = 0; i < doneIds.length; i++) {
      await fetch(`/api/inspirations/${doneIds[i]}/analyze`, { method: "POST" });
      setAnalyzeProgress(i + 1);
    }
    setAnalyzingBatch(false);
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const editingFile = editingId ? files.find((f) => f.inspirationId === editingId) : null;

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        animate={{ borderColor: dragging ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)" }}
        className={cn(
          "relative border-2 border-dashed rounded-xl transition-colors cursor-pointer",
          "flex flex-col items-center justify-center gap-3",
          "min-h-[200px] bg-[var(--bg-surface)]",
          dragging && "bg-[var(--bg-elevated)]"
        )}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" multiple accept={ACCEPTED.join(",")} className="hidden" onChange={onInputChange} />
        <AnimatePresence mode="wait">
          {dragging ? (
            <motion.div key="drag" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <p className="text-[var(--text-primary)] text-lg font-light">Déposer ici</p>
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center px-8">
              <div className="text-3xl mb-3 opacity-30">↑</div>
              <p className="text-[var(--text-secondary)] text-sm mb-1">Glisse tes images ici ou clique pour sélectionner</p>
              <p className="text-[var(--text-tertiary)] text-xs">JPG, PNG, WebP, GIF, AVIF — max {MAX_SIZE_MB} MB par fichier</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* File grid */}
      {files.length > 0 && (
        <div>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 mb-4">
            {files.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative aspect-square rounded-md overflow-hidden bg-[var(--bg-elevated)] group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.preview} alt="" className="w-full h-full object-cover" />

                {item.status === "uploading" && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Spinner size="sm" />
                  </div>
                )}
                {item.status === "error" && (
                  <div className="absolute inset-0 bg-red-900/60 flex items-center justify-center p-1">
                    <span className="text-red-300 text-[9px] text-center leading-tight">{item.error}</span>
                  </div>
                )}

                {/* Done — green dot + edit button */}
                {item.status === "done" && item.inspirationId && (
                  <>
                    <div className="absolute top-1 left-1 w-4 h-4 bg-green-500/80 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-[8px]">✓</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(item.inspirationId!); }}
                      className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-end justify-end p-1.5 opacity-0 group-hover:opacity-100"
                    >
                      <span className="text-white text-[10px] bg-black/60 px-1.5 py-0.5 rounded">✎</span>
                    </button>
                  </>
                )}

                {item.status === "pending" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(item.id); }}
                    className="absolute top-1 right-1 w-4 h-4 bg-black/60 rounded-full text-white/80 text-[9px] hidden group-hover:flex items-center justify-center hover:bg-red-500/80"
                  >
                    ×
                  </button>
                )}
              </motion.div>
            ))}
          </div>

          {/* Status + upload button */}
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-xs text-[var(--text-tertiary)]">
              {pendingCount > 0 && <span>{pendingCount} en attente</span>}
              {doneFiles.length > 0 && <span className="text-green-400">{doneFiles.length} importée{doneFiles.length > 1 ? "s" : ""}</span>}
              {errorCount > 0 && <span className="text-red-400">{errorCount} erreur(s)</span>}
            </div>
            <div className="flex gap-2">
              {doneFiles.length > 0 && (
                <button
                  onClick={() => router.push("/library")}
                  className="px-4 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Voir la bibliothèque →
                </button>
              )}
              {pendingCount > 0 && (
                <button
                  onClick={uploadAll}
                  disabled={uploading}
                  className="px-5 py-2 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2"
                >
                  {uploading && <Spinner size="sm" />}
                  {uploading ? "Import en cours…" : `Importer ${pendingCount} image${pendingCount > 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Batch metadata panel — appears once at least 1 file is uploaded ── */}
      <AnimatePresence>
        {doneFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-surface)] overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">
                  Métadonnées — appliquer à tout l&apos;import
                </p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  {doneIds.length} image{doneIds.length > 1 ? "s" : ""} — survole une image pour éditer individuellement
                </p>
              </div>
            </div>

            <div className="p-5 grid grid-cols-3 gap-5">
              {/* Title */}
              <div>
                <label className={sectionLabel}>Titre (identique pour toutes)</label>
                <input
                  className={fieldClass}
                  placeholder="Laisser vide = inchangé"
                  value={batchTitle}
                  onChange={(e) => setBatchTitle(e.target.value)}
                />
              </div>

              {/* Category */}
              <div>
                <label className={sectionLabel}>Catégorie</label>
                {categories.length > 0 ? (
                  <CategorySelect categories={categories} value={batchCategory} onChange={setBatchCategory} showCreateButton />
                ) : (
                  <div className={`${fieldClass} text-[var(--text-tertiary)]`}>Chargement…</div>
                )}
              </div>

              {/* Tags */}
              <div>
                <label className={sectionLabel}>Ajouter des tags</label>
                <TagInput value={batchTags} onChange={setBatchTags} placeholder="Entrée pour valider…" />
              </div>
            </div>

            {/* ── Toggle analyse IA ── */}
            <div className="px-5 py-4 border-t border-[var(--border-subtle)] flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-widest">
                    ✦ Analyse IA (Gemini)
                  </span>
                  {/* Toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={aiEnabled}
                    onClick={() => setAiEnabled((v) => !v)}
                    className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 focus:outline-none ${
                      aiEnabled ? "bg-[var(--accent,#a78bfa)]" : "bg-[var(--bg-overlay)]"
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 mt-px rounded-full bg-white shadow transition-transform duration-200 ${
                        aiEnabled ? "translate-x-3.5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className={`text-[9px] ${aiEnabled ? "text-[var(--accent,#a78bfa)]" : "text-[var(--text-tertiary)]"}`}>
                    {aiEnabled ? "Activée" : "Désactivée"}
                  </span>
                </div>
                <p className="text-[9px] text-[var(--text-tertiary)] leading-relaxed max-w-lg">
                  Quand activée, une vignette 256 px de chaque image est envoyée à l&apos;API Google Gemini
                  (serveurs hors UE). Google peut utiliser ces données pour améliorer ses modèles.
                  Désactivée par défaut — activez uniquement si vous acceptez ces conditions.
                </p>
              </div>

              {/* Bouton batch — visible seulement si IA activée */}
              {aiEnabled && (
                <button
                  type="button"
                  onClick={analyzeBatch}
                  disabled={analyzingBatch}
                  className="flex-shrink-0 text-[10px] text-[var(--accent,#a78bfa)] hover:opacity-80 transition-opacity disabled:opacity-40 flex items-center gap-1.5 font-medium mt-0.5"
                >
                  {analyzingBatch ? (
                    <>
                      <div className="w-2.5 h-2.5 rounded-full border-2 border-[var(--accent,#a78bfa)] border-t-transparent animate-spin" />
                      {analyzeProgress}/{doneIds.length}…
                    </>
                  ) : (
                    <>Analyser tout</>
                  )}
                </button>
              )}
            </div>

            <div className="px-5 pb-5 flex justify-end">
              <Button
                size="sm"
                onClick={applyBatchMetadata}
                loading={applyingBatch}
                disabled={!batchTitle.trim() && !batchCategory.categoryId && batchTags.length === 0}
              >
                {batchApplied ? "Appliqué ✓" : `Appliquer aux ${doneIds.length} images`}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Per-item slide-over ── */}
      <AnimatePresence>
        {editingId && editingFile && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setEditingId(null)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.32 }}
              className="fixed top-0 right-0 bottom-0 w-[480px] bg-[var(--bg-base)] border-l border-[var(--border-subtle)] z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] flex-shrink-0">
                <p className="text-xs text-[var(--text-secondary)] truncate max-w-[320px]">
                  {editingFile.file.name}
                </p>
                <button onClick={() => setEditingId(null)} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ml-2">✕</button>
              </div>
              <div className="h-48 bg-[var(--bg-surface)] flex-shrink-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={editingFile.preview} alt="" className="w-full h-full object-contain" />
              </div>
              <div className="flex-1 overflow-hidden">
                <MetadataPanel
                  id={editingId}
                  initialData={{
                    title: editingFile.file.name.replace(/\.[^/.]+$/, ""),
                    description: "",
                    author: "",
                    studio: "",
                    country: "",
                    notes: "",
                    sourceUrl: "",
                  }}
                  autoAnalyze={aiEnabled}
                  aiFirst
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
