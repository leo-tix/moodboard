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
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";

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
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    setIsTouchDevice(navigator.maxTouchPoints > 1);
  }, []);

  // Per-item metadata drawer
  const [editingId, setEditingId] = useState<string | null>(null);

  // Batch metadata for all uploaded
  const [categories, setCategories] = useState<Category[]>([]);
  const [batchCategory, setBatchCategory] = useState({ categoryId: "", subcategoryId: "" });
  const [batchTags, setBatchTags] = useState<string[]>([]);
  const [batchTitle, setBatchTitle] = useState("");
  const [applyingBatch, setApplyingBatch] = useState(false);
  const [batchApplied, setBatchApplied] = useState(false);

  // Contexte de visite (musée / exposition) — appliqué à tout le lot
  const [visitEnabled, setVisitEnabled] = useState(false);
  const [visitPlace, setVisitPlace] = useState("");
  const [visitExhibition, setVisitExhibition] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [visitGeo, setVisitGeo] = useState<PlaceGeo | null>(null);

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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles]
  );

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
                f.id === item.id ? { ...f, status: "error", error: data.error ?? "Erreur" } : f
              )
            );
            return null;
          }

          const inspirationId: string = data.inspirationId;
          setFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, status: "done", inspirationId } : f))
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
  };

  const hasVisitContext = visitEnabled && visitPlace.trim().length > 0;

  const applyBatchMetadata = async () => {
    if (!doneIds.length) return;
    const hasPatch = batchTitle.trim() || batchCategory.categoryId || batchTags.length > 0;
    if (!hasPatch && !hasVisitContext) return;

    setApplyingBatch(true);
    try {
      if (hasPatch) {
        await fetch("/api/inspirations/batch", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: doneIds,
            patch: {
              ...(batchTitle.trim() ? { title: batchTitle.trim() } : {}),
              ...(batchCategory.categoryId
                ? {
                    addCategory: {
                      categoryId: batchCategory.categoryId,
                      subcategoryId: batchCategory.subcategoryId || null,
                    },
                  }
                : {}),
              ...(batchTags.length > 0 ? { addTags: batchTags } : {}),
            },
          }),
        });
      }

      // Contexte de visite : crée (ou réutilise) la visite et rattache le lot
      if (hasVisitContext) {
        await fetch("/api/visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            place: visitPlace.trim(),
            exhibition: visitExhibition.trim() || undefined,
            visitDate,
            inspirationIds: doneIds,
            ...(visitGeo
              ? {
                  latitude: visitGeo.latitude,
                  longitude: visitGeo.longitude,
                  address: visitGeo.address,
                }
              : {}),
          }),
        });
      }

      setBatchApplied(true);
      setTimeout(() => setBatchApplied(false), 2500);
    } finally {
      setApplyingBatch(false);
    }
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const editingFile = editingId ? files.find((f) => f.inspirationId === editingId) : null;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <motion.div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        animate={{
          borderColor: dragging ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)",
        }}
        className={cn(
          "relative border-2 border-dashed rounded-xl transition-colors cursor-pointer",
          "flex flex-col items-center justify-center gap-3",
          "min-h-[200px] bg-[var(--bg-surface)]",
          dragging && "bg-[var(--bg-elevated)]"
        )}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={onInputChange}
        />
        <AnimatePresence mode="wait">
          {dragging ? (
            <motion.div
              key="drag"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="text-[var(--text-primary)] text-lg font-light">Déposer ici</p>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center px-8"
            >
              <div className="text-3xl mb-3 opacity-30">↑</div>
              <p className="text-[var(--text-secondary)] text-sm mb-1">
                {isTouchDevice
                  ? "Appuie pour sélectionner tes images"
                  : "Glisse tes images ici ou clique pour sélectionner"}
              </p>
              <p className="text-[var(--text-tertiary)] text-xs">
                JPG, PNG, WebP, GIF, AVIF — max {MAX_SIZE_MB} MB par fichier
              </p>
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

                {/* Upload en cours */}
                {item.status === "uploading" && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Spinner size="sm" />
                  </div>
                )}

                {/* Erreur upload */}
                {item.status === "error" && (
                  <div className="absolute inset-0 bg-red-900/60 flex items-center justify-center p-1">
                    <span className="text-red-300 text-[9px] text-center leading-tight">
                      {item.error}
                    </span>
                  </div>
                )}

                {/* Done — indicateurs */}
                {item.status === "done" && item.inspirationId && (
                  <>
                    {/* Pastille statut */}
                    <div className="absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 bg-green-500/80">
                      <span className="text-white text-[8px]">✓</span>
                    </div>

                    {/* Bouton éditer — toujours visible sur touch, au survol sinon */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(item.inspirationId!);
                      }}
                      className={`absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-end justify-end p-1.5 ${isTouchDevice ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                    >
                      <span className="text-white text-[10px] bg-black/60 px-1.5 py-0.5 rounded">
                        ✎
                      </span>
                    </button>
                  </>
                )}

                {/* Supprimer avant upload — toujours visible sur touch */}
                {item.status === "pending" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(item.id);
                    }}
                    className={`absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full text-white/80 text-[9px] ${isTouchDevice ? "flex" : "hidden group-hover:flex"} items-center justify-center hover:bg-red-500/80`}
                  >
                    ×
                  </button>
                )}
              </motion.div>
            ))}
          </div>

          {/* Status + upload button */}
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-xs text-[var(--text-tertiary)] flex-wrap">
              {pendingCount > 0 && <span>{pendingCount} en attente</span>}
              {doneFiles.length > 0 && (
                <span className="text-green-400">
                  {doneFiles.length} importée{doneFiles.length > 1 ? "s" : ""}
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-red-400">{errorCount} erreur(s)</span>
              )}
            </div>
            <div className="flex gap-2">
              {doneFiles.length > 0 && (
                <button
                  onClick={() => router.push("/triage")}
                  className="px-4 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Voir le triage →
                </button>
              )}
              {pendingCount > 0 && (
                <button
                  onClick={uploadAll}
                  disabled={uploading}
                  className="px-5 py-2 bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2"
                >
                  {uploading && <Spinner size="sm" />}
                  {uploading
                    ? "Import en cours…"
                    : `Importer ${pendingCount} image${pendingCount > 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Batch metadata panel ── */}
      <AnimatePresence>
        {doneFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-surface)] overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Métadonnées — appliquer à tout l&apos;import
              </p>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                {doneIds.length} image{doneIds.length > 1 ? "s" : ""} —{" "}
                {isTouchDevice ? "appuie sur ✎" : "survole une image"} pour éditer individuellement
              </p>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div>
                <label className={sectionLabel}>Titre (identique pour toutes)</label>
                <input
                  className={fieldClass}
                  placeholder="Laisser vide = inchangé"
                  value={batchTitle}
                  onChange={(e) => setBatchTitle(e.target.value)}
                />
              </div>
              <div>
                <label className={sectionLabel}>Catégorie</label>
                {categories.length > 0 ? (
                  <CategorySelect
                    categories={categories}
                    value={batchCategory}
                    onChange={setBatchCategory}
                    showCreateButton
                  />
                ) : (
                  <div className={`${fieldClass} text-[var(--text-tertiary)]`}>Chargement…</div>
                )}
              </div>
              <div>
                <label className={sectionLabel}>Ajouter des tags</label>
                <TagInput value={batchTags} onChange={setBatchTags} placeholder="Entrée pour valider…" />
              </div>
            </div>

            {/* ── Contexte de visite (musée / exposition) ── */}
            <div className="border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setVisitEnabled((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <div className="text-left">
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    🏛 Contexte de visite
                  </p>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    Photos prises lors d&apos;une visite (musée, galerie, expo…) — regroupées dans le carnet de visite
                  </p>
                </div>
                <div
                  role="switch"
                  aria-checked={visitEnabled}
                  className={cn(
                    "relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
                    visitEnabled ? "bg-[var(--text-primary)]" : "bg-[var(--bg-overlay)]"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                      visitEnabled ? "translate-x-3" : "translate-x-0"
                    )}
                  />
                </div>
              </button>

              <AnimatePresence>
                {visitEnabled && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-5">
                      <div>
                        <label className={sectionLabel}>Lieu *</label>
                        <PlaceAutocomplete
                          className={fieldClass}
                          placeholder="Musée d'Orsay, Palais de Tokyo…"
                          value={visitPlace}
                          onChange={setVisitPlace}
                          onSelectGeo={setVisitGeo}
                        />
                        {visitGeo && (
                          <p className="text-[9px] text-[var(--text-tertiary)] mt-1 truncate">
                            📍 {visitGeo.address}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className={sectionLabel}>Exposition</label>
                        <input
                          className={fieldClass}
                          placeholder="Nom de l'expo (optionnel)"
                          value={visitExhibition}
                          onChange={(e) => setVisitExhibition(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className={sectionLabel}>Date de visite</label>
                        <input
                          type="date"
                          className={fieldClass}
                          value={visitDate}
                          onChange={(e) => setVisitDate(e.target.value)}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="px-5 pb-5 pt-2 flex justify-end">
              <Button
                size="sm"
                onClick={applyBatchMetadata}
                loading={applyingBatch}
                disabled={
                  !batchTitle.trim() &&
                  !batchCategory.categoryId &&
                  batchTags.length === 0 &&
                  !hasVisitContext
                }
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
              className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-[var(--bg-base)] border-l border-[var(--border-subtle)] z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-xs text-[var(--text-secondary)] truncate max-w-[280px]">
                    {editingFile.file.name}
                  </p>
                </div>
                <button
                  onClick={() => setEditingId(null)}
                  className="w-9 h-9 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ml-2 flex-shrink-0"
                >
                  ✕
                </button>
              </div>
              <div className="h-48 bg-[var(--bg-surface)] flex-shrink-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={editingFile.preview}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex-1 overflow-hidden">
                <MetadataPanel
                  id={editingId}
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
    </div>
  );
}
