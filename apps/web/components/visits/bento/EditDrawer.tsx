"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2 } from "lucide-react";
import { NoteEditor } from "@/components/visits/NoteEditor";
import { TitleEditor } from "@/components/visits/TitleEditor";
import { QuoteEditor } from "@/components/visits/QuoteEditor";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";
import { FormatPicker } from "@/components/visits/bento/FormatPicker";
import type { TileSpan } from "@/lib/visits/bentoSpans";
import type { BentoTile } from "@/lib/visits/bentoTypes";

interface EditDrawerProps {
  tile: BentoTile | null;
  onClose: () => void;
  onSetSpan: (tile: BentoTile, span: TileSpan) => void;
  onDelete: (tile: BentoTile) => void;
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
// latéral (desktop) / bottom sheet (mobile). Point d'entrée UNIQUE pour tout
// ce qui concerne une tuile : son format, son contenu, sa suppression. Les
// tuiles elles-mêmes ne portent plus qu'un bouton "Modifier" (audit
// 2026-07-17 : 3 contrôles flottants sur une tuile de 165px en mobile
// masquaient le contenu, et le format se réglait via un cycle invisible).
export function EditDrawer({
  tile,
  onClose,
  onSetSpan,
  onDelete,
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Le panneau coulisse depuis le BAS en bottom sheet (mobile) et depuis la
  // DROITE en panneau latéral (desktop) — Framer ne sait pas conditionner ses
  // valeurs d'animation par media query, d'où ce matchMedia (même pattern que
  // AudioPlayer.tsx pour `compact`).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!tile) return;
    setConfirmDelete(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tile, onClose]);

  if (typeof document === "undefined") return null;

  const offscreen = isMobile ? { y: "100%" } : { x: "100%" };

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
            initial={offscreen}
            animate={{ x: 0, y: 0 }}
            exit={offscreen}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
            className={[
              "fixed z-[81] bg-[var(--bg-elevated)] border-[var(--border-default)] shadow-2xl flex flex-col",
              // Mobile : bottom sheet plafonné à 80vh (le contenu défile).
              "inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl border-t",
              // Desktop : panneau latéral PLEINE HAUTEUR. Le plafond de hauteur
              // du bottom sheet écrasait sinon top-0/bottom-0 et laissait un
              // panneau flottant de 576px collé en haut à droite (audit
              // 2026-07-17).
              "sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:w-[380px] sm:max-h-none sm:rounded-t-none sm:border-t-0 sm:border-l",
            ].join(" ")}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{DRAWER_TITLES[tile.type]}</p>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors" aria-label="Fermer">
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-5">
              <FormatPicker type={tile.type} current={{ w: tile.w, h: tile.h }} onChange={(span) => onSetSpan(tile, span)} />

              <div className="space-y-1.5">
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
                  <p className="text-xs text-[var(--text-tertiary)]">Vidéo YouTube — supprime et réajoute la tuile pour changer le lien.</p>
                )}
                {tile.content.type === "audio" && (
                  <p className="text-xs text-[var(--text-tertiary)]">Mémo vocal — la transcription s&apos;édite directement sur la tuile (icône crayon).</p>
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
            </div>

            {/* Suppression — en pied de panneau, avec confirmation : le geste
                est destructif et il n'y a pas d'annulation (audit 2026-07-17). */}
            <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex-shrink-0">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { onDelete(tile); onClose(); }}
                    className="flex-1 px-3 py-2 text-xs rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                  >
                    {tile.type === "image" ? "Retirer du carnet" : "Supprimer définitivement"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-2 text-xs rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-red-400 hover:bg-[var(--bg-surface)] transition-colors"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                  {tile.type === "image" ? "Retirer du carnet" : "Supprimer"}
                </button>
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
  image: "Image",
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
        <input value={y} onChange={(e) => setY(e.target.value.replace(/[^0-9]/g, ""))} onBlur={() => onSave(t, a, y)} className={inputClass} inputMode="numeric" />
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
