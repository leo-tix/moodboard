"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";

interface CreateVisitModalProps {
  /** IDs des inspirations à rattacher à la nouvelle visite */
  inspirationIds: string[];
  onClose: () => void;
  onCreated?: (visitId: string, place: string) => void;
}

const fld =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm rounded px-3 py-2 focus:outline-none focus:border-[var(--border-default)] transition-colors placeholder:text-[var(--text-tertiary)]";

// Création rapide d'une visite pour un lot d'inspirations (drag & drop bibliothèque,
// import batch...) — formulaire minimal, à la manière de AddToCollectionModal.
export function CreateVisitModal({ inspirationIds, onClose, onCreated }: CreateVisitModalProps) {
  const [place, setPlace] = useState("");
  const [exhibition, setExhibition] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [geo, setGeo] = useState<PlaceGeo | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const create = async () => {
    if (!place.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place: place.trim(),
          exhibition: exhibition.trim() || undefined,
          visitDate,
          inspirationIds,
          ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, address: geo.address } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) throw new Error(data.error ?? "Erreur");
      onCreated?.(data.id, data.place);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const content = (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 24 }}
        transition={{ duration: 0.16 }}
        className="fixed z-[61] bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl flex flex-col inset-x-0 bottom-0 w-full rounded-t-2xl md:inset-x-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-80 md:rounded-lg"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex md:hidden justify-center pt-2.5 pb-0.5 flex-shrink-0">
          <div className="w-8 h-1 rounded-full bg-[var(--border-default)]" />
        </div>

        <div className="flex items-center justify-between px-4 py-2 md:py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
          <p className="text-sm md:text-xs font-medium text-[var(--text-primary)]">
            Nouvelle visite
            {inspirationIds.length > 1 && (
              <span className="ml-1.5 text-[var(--text-tertiary)] font-normal">
                ({inspirationIds.length} images)
              </span>
            )}
          </p>
          <button
            onClick={onClose}
            className="w-9 h-9 md:w-auto md:h-auto flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          <PlaceAutocomplete
            className={fld}
            placeholder="Lieu * (musée, galerie…)"
            value={place}
            onChange={setPlace}
            onSelectGeo={setGeo}
          />
          <input
            className={fld}
            placeholder="Exposition (optionnel)"
            value={exhibition}
            onChange={(e) => setExhibition(e.target.value)}
          />
          <input
            type="date"
            className={fld}
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={create}
            disabled={creating || !place.trim()}
            className="w-full py-2 text-sm font-medium bg-[var(--text-primary)] text-[var(--bg-base)] rounded-md disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {creating ? "Création…" : inspirationIds.length > 0 ? "Créer et rattacher" : "Créer la visite"}
          </button>
        </div>
      </motion.div>
    </>
  );

  if (typeof window === "undefined") return null;
  return createPortal(<AnimatePresence>{content}</AnimatePresence>, document.body);
}
