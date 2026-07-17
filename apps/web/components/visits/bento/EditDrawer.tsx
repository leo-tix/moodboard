"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { NoteEditor } from "@/components/visits/NoteEditor";
import { TitleEditor } from "@/components/visits/TitleEditor";
import { QuoteEditor } from "@/components/visits/QuoteEditor";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";
import type { BentoTile } from "@/lib/visits/bentoTypes";

interface EditDrawerProps {
  tile: BentoTile | null;
  onClose: () => void;
  onSaveNote: (id: string, html: string) => void;
  onPersistNote: (id: string, html: string) => Promise<void>;
  onSaveTitle: (id: string, text: string) => void;
  onPersistTitle: (id: string, text: string) => Promise<void>;
  onSaveQuote: (id: string, text: string) => void;
  onPersistQuote: (id: string, text: string) => Promise<void>;
  onSaveImage: (id: string, title: string, author: string, year: string) => void;
  onSaveEmbed: (id: string, title: string, description: string) => void;
  onSaveMap: (id: string, locationName: string, latitude: number, longitude: number) => void;
}

// Panneau d'édition — spec §2.3 : un clic sur une tuile ouvre un panneau
// latéral (desktop) / bottom sheet (mobile, sous `sm:`), les champs mettent
// à jour l'état en temps réel. Une seule instance, montée par VisitJournal,
// contenu affiché conditionné par `tile.type` (le mémo audio n'y passe
// jamais — il édite son transcript via son propre crayon inline).
export function EditDrawer({
  tile,
  onClose,
  onSaveNote,
  onPersistNote,
  onSaveTitle,
  onPersistTitle,
  onSaveQuote,
  onPersistQuote,
  onSaveImage,
  onSaveEmbed,
  onSaveMap,
}: EditDrawerProps) {
  useEffect(() => {
    if (!tile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tile, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {tile && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[80]"
            onClick={onClose}
          />
          <motion.div
            // `y` en pourcentage ("100%") se convertit en px à partir de la
            // hauteur du panneau au moment du mount — mais cette hauteur est
            // encore intrinsèque/dynamique ici (contenu variable : textarea
            // qui s'auto-redimensionne juste après le montage). Le calcul se
            // fige sur une valeur obsolète et le panneau restait bloqué hors
            // écran sur mobile (bug constaté 2026-07-17). Un décalage fixe en
            // px n'a pas ce problème.
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            className="fixed z-[81] inset-x-0 bottom-0 rounded-t-2xl sm:rounded-t-none sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:w-[380px] bg-[var(--bg-elevated)] border-t sm:border-t-0 sm:border-l border-[var(--border-default)] shadow-2xl flex flex-col"
            style={{ maxHeight: "min(80vh, 640px)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{DRAWER_TITLES[tile.type]}</p>
              <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors" aria-label="Fermer">
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {tile.content.type === "note" && (
                <NoteEditor
                  key={tile.id}
                  content={tile.content.content}
                  editable
                  onBlurSave={(html) => onSaveNote(tile.id, html)}
                  onAutoSave={(html) => onPersistNote(tile.id, html)}
                  placeholder="Écris…"
                />
              )}
              {tile.content.type === "title" && (
                <TitleEditor
                  key={tile.id}
                  content={tile.content.content}
                  editable
                  onBlurSave={(text) => onSaveTitle(tile.id, text)}
                  onAutoSave={(text) => onPersistTitle(tile.id, text)}
                  placeholder="Titre…"
                />
              )}
              {tile.content.type === "quote" && (
                <QuoteEditor
                  key={tile.id}
                  content={tile.content.content}
                  editable
                  onBlurSave={(text) => onSaveQuote(tile.id, text)}
                  onAutoSave={(text) => onPersistQuote(tile.id, text)}
                  placeholder="Citation…"
                />
              )}
              {tile.content.type === "image" && (
                <ImageForm
                  key={tile.id}
                  title={tile.content.title}
                  author={tile.content.author ?? ""}
                  year={tile.content.year ?? null}
                  onSave={(title, author, year) => onSaveImage(tile.id, title, author, year)}
                />
              )}
              {tile.content.type === "embed" && tile.content.kind === "LINK" && (
                <EmbedForm
                  key={tile.id}
                  title={tile.content.title ?? ""}
                  description={tile.content.description ?? ""}
                  onSave={(title, description) => onSaveEmbed(tile.id, title, description)}
                />
              )}
              {tile.content.type === "embed" && tile.content.kind === "YOUTUBE" && (
                <p className="text-xs text-[var(--text-tertiary)]">Pas de champ éditable pour une vidéo YouTube — supprime et réajoute pour changer le lien.</p>
              )}
              {tile.content.type === "map" && (
                <MapForm
                  key={tile.id}
                  locationName={tile.content.locationName}
                  latitude={tile.content.latitude}
                  longitude={tile.content.longitude}
                  onSave={(name, lat, lng) => onSaveMap(tile.id, name, lat, lng)}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

const DRAWER_TITLES: Record<BentoTile["type"], string> = {
  image: "Cartel de l'image",
  note: "Texte",
  title: "Titre",
  quote: "Citation",
  audio: "Mémo vocal",
  embed: "Lien",
  map: "Carte",
};

function ImageForm({
  title,
  author,
  year,
  onSave,
}: {
  title: string;
  author: string;
  year: number | null;
  onSave: (title: string, author: string, year: string) => void;
}) {
  const [t, setT] = useState(title);
  const [a, setA] = useState(author);
  const [y, setY] = useState(year ? String(year) : "");

  return (
    <div className="space-y-3">
      <Field label="Titre">
        <input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => onSave(t, a, y)} className={inputClass} />
      </Field>
      <Field label="Auteur">
        <input value={a} onChange={(e) => setA(e.target.value)} onBlur={() => onSave(t, a, y)} className={inputClass} />
      </Field>
      <Field label="Année">
        <input value={y} onChange={(e) => setY(e.target.value.replace(/[^0-9]/g, ""))} onBlur={() => onSave(t, a, y)} className={inputClass} />
      </Field>
    </div>
  );
}

function EmbedForm({
  title,
  description,
  onSave,
}: {
  title: string;
  description: string;
  onSave: (title: string, description: string) => void;
}) {
  const [t, setT] = useState(title);
  const [d, setD] = useState(description);

  return (
    <div className="space-y-3">
      <Field label="Titre">
        <input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => onSave(t, d)} className={inputClass} />
      </Field>
      <Field label="Description">
        <textarea value={d} onChange={(e) => setD(e.target.value)} onBlur={() => onSave(t, d)} rows={3} className={inputClass} />
      </Field>
    </div>
  );
}

function MapForm({
  locationName,
  latitude,
  longitude,
  onSave,
}: {
  locationName: string;
  latitude: number;
  longitude: number;
  onSave: (locationName: string, latitude: number, longitude: number) => void;
}) {
  const [value, setValue] = useState(locationName);
  const [geo, setGeo] = useState<PlaceGeo | null>({ latitude, longitude, address: locationName });

  return (
    <div className="space-y-3">
      <Field label="Lieu">
        <PlaceAutocomplete
          value={value}
          onChange={setValue}
          onSelectGeo={(g) => {
            setGeo(g);
            if (g) onSave(value.trim() || g.address, g.latitude, g.longitude);
          }}
          className={inputClass}
        />
      </Field>
      <button
        type="button"
        onClick={() => geo && onSave(value.trim() || geo.address, geo.latitude, geo.longitude)}
        className="text-xs px-3 py-1.5 rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] transition-opacity hover:opacity-90"
      >
        Enregistrer le nom
      </button>
    </div>
  );
}

const inputClass =
  "w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)] resize-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}
