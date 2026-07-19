"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ImageIcon, X, Check, ImagePlus, Camera, LayoutGrid, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";

interface PickImage {
  id: string;
  storageKey: string;
  thumbnailKey: string | null;
}

// Éditeur de couverture de visite (2026-07-19) : soit une image PERSONNALISÉE
// (choisie parmi les photos de la visite ou importée), soit le carrousel par
// défaut. Bouton discret sur la cover → pop-up de choix. Éditeur seulement,
// jamais rendu sur la page publique.
export function VisitCoverEditor({
  visitId,
  currentCoverKey,
  images,
  className,
}: {
  visitId: string;
  currentCoverKey: string | null;
  images: PickImage[];
  /** Style du bouton déclencheur (placement laissé au parent). */
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const setCoverKey = async (coverKey: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/visits/${visitId}/cover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverKey }),
      });
      if (!res.ok) throw new Error();
      setOpen(false);
      router.refresh();
    } catch {
      setError("Échec de la mise à jour de la couverture.");
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/visits/${visitId}/cover`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Modifier la couverture"
        aria-label="Modifier la couverture"
        className={cn(
          "flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm text-white/90 hover:bg-black/70 transition-colors",
          className ?? "w-9 h-9"
        )}
      >
        <ImageIcon size={16} strokeWidth={2} />
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
                  onClick={() => !busy && setOpen(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.16 }}
                  className="fixed z-[81] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-md bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                  style={{ maxHeight: "min(32rem, 85vh)" }}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">Couverture de la visite</p>
                    <button onClick={() => !busy && setOpen(false)} className="w-7 h-7 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors" aria-label="Fermer">
                      <X size={16} strokeWidth={2} />
                    </button>
                  </div>

                  <div className="p-4 overflow-y-auto flex-1 space-y-4">
                    {/* Carrousel par défaut */}
                    <button
                      type="button"
                      onClick={() => setCoverKey(null)}
                      disabled={busy}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left disabled:opacity-60",
                        !currentCoverKey ? "border-[var(--text-primary)] bg-[var(--bg-surface)]" : "border-[var(--border-default)] hover:border-[var(--text-tertiary)]"
                      )}
                    >
                      <span className="w-9 h-9 rounded-lg bg-[var(--bg-surface)] flex items-center justify-center shrink-0">
                        <LayoutGrid size={16} strokeWidth={2} className="text-[var(--text-secondary)]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-[var(--text-primary)]">Carrousel par défaut</span>
                        <span className="block text-[11px] text-[var(--text-tertiary)]">Les photos de la visite défilent</span>
                      </span>
                      {!currentCoverKey && <Check size={16} strokeWidth={2.5} className="text-[var(--text-primary)] shrink-0" />}
                    </button>

                    {/* Import d'une nouvelle photo */}
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => galleryRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] disabled:opacity-50 transition-opacity">
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} strokeWidth={2} />} Importer
                      </button>
                      <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-50 transition-opacity">
                        <Camera size={13} strokeWidth={2} /> Photo
                      </button>
                    </div>
                    <input ref={galleryRef} type="file" accept="image/*" onChange={onImport} className="hidden" />
                    <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onImport} className="hidden" />

                    {error && <p className="text-xs text-red-400">{error}</p>}

                    {/* Photos de la visite */}
                    {images.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">Photos de la visite</p>
                        <div className="grid grid-cols-3 gap-2">
                          {images.map((img) => {
                            const active = currentCoverKey === img.storageKey;
                            const thumb = img.thumbnailKey ?? img.storageKey;
                            return (
                              <button
                                key={img.id}
                                type="button"
                                onClick={() => setCoverKey(img.storageKey)}
                                disabled={busy}
                                className={cn(
                                  "relative aspect-square rounded-lg overflow-hidden bg-[var(--bg-surface)] disabled:opacity-60",
                                  active ? "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-elevated)]" : ""
                                )}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={getThumbnailUrl(thumb)} alt="" loading="lazy" className="w-full h-full object-cover" />
                                {active && (
                                  <span className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                    <Check size={18} strokeWidth={2.5} className="text-white" />
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
