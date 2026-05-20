"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/Spinner";

interface UploadFile {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  inspirationId?: string;
  error?: string;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_SIZE_MB = 10;

export function DropZone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const addFiles = useCallback((rawFiles: File[]) => {
    const valid = rawFiles.filter(
      (f) => ACCEPTED.includes(f.type) && f.size <= MAX_SIZE_MB * 1024 * 1024
    );
    const newFiles: UploadFile[] = valid.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      preview: URL.createObjectURL(f),
      status: "pending",
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      addFiles(dropped);
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

    for (const item of pending) {
      setFiles((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: "uploading" } : f))
      );

      try {
        const formData = new FormData();
        formData.append("file", item.file);

        const res = await fetch("/api/upload/image", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? { ...f, status: "error", error: data.error ?? "Erreur" }
                : f
            )
          );
          continue;
        }

        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, status: "done", inspirationId: data.inspirationId }
              : f
          )
        );
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id ? { ...f, status: "error", error: "Erreur réseau" } : f
          )
        );
      }
    }

    setUploading(false);
  };

  const doneCount = files.filter((f) => f.status === "done").length;
  const pendingCount = files.filter((f) => f.status === "pending").length;
  const errorCount = files.filter((f) => f.status === "error").length;

  return (
    <div className="space-y-4">
      {/* Zone de drop */}
      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        animate={{ borderColor: dragging ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)" }}
        className={cn(
          "relative border-2 border-dashed rounded-xl transition-colors cursor-pointer",
          "flex flex-col items-center justify-center gap-3",
          "min-h-[280px] bg-[var(--bg-surface)]",
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

        <AnimatePresence>
          {dragging ? (
            <motion.div
              key="dragging"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
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
                Glisse tes images ici ou clique pour sélectionner
              </p>
              <p className="text-[var(--text-tertiary)] text-xs">
                JPG, PNG, WebP, GIF, AVIF — max {MAX_SIZE_MB} MB par fichier
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Grille de preview */}
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
                {/* Preview */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.preview}
                  alt=""
                  className="w-full h-full object-cover"
                />

                {/* Overlay statut */}
                <div className="absolute inset-0 flex items-center justify-center">
                  {item.status === "uploading" && (
                    <div className="bg-black/50 absolute inset-0 flex items-center justify-center">
                      <Spinner size="sm" />
                    </div>
                  )}
                  {item.status === "done" && (
                    <div className="bg-black/40 absolute inset-0 flex items-center justify-center">
                      <span className="text-green-400 text-sm">✓</span>
                    </div>
                  )}
                  {item.status === "error" && (
                    <div className="bg-red-900/50 absolute inset-0 flex items-center justify-center p-1">
                      <span className="text-red-300 text-[9px] text-center leading-tight">
                        {item.error}
                      </span>
                    </div>
                  )}
                </div>

                {/* Bouton supprimer */}
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

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-xs text-[var(--text-tertiary)]">
              {pendingCount > 0 && <span>{pendingCount} en attente</span>}
              {doneCount > 0 && <span className="text-green-400">{doneCount} importées</span>}
              {errorCount > 0 && <span className="text-red-400">{errorCount} erreur(s)</span>}
            </div>

            <div className="flex gap-2">
              {doneCount > 0 && (
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
    </div>
  );
}
