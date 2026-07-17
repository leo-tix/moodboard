"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Heading, Pilcrow, Quote, Mic, MapPin, Link2, Video, X, type LucideIcon } from "lucide-react";
import { parseYouTubeId } from "@/lib/visits/linkPreview";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";

// Pop-up UNIQUE de choix de type de tuile — grille bento (2026-07-15).
// Centrée + voile flouté, IDENTIQUE mobile et desktop (demande explicite
// utilisateur 2026-07-14 : "simplifier au max l'ergonomie" — plus de logique
// d'ancrage/débordement d'écran à gérer par point d'entrée). Un seul
// composant sert tous les points d'entrée du bouton "+ Ajouter" de la grille.
interface BlockTypeModalProps {
  onClose: () => void;
  onSelectSimple: (type: "title" | "note" | "quote") => void;
  onSelectAudio: () => void;
  onSelectEmbed: (kind: "LINK" | "YOUTUBE", url: string) => void;
  onSelectMap: (locationName: string, latitude: number, longitude: number) => void;
}

export function BlockTypeModal({ onClose, onSelectSimple, onSelectAudio, onSelectEmbed, onSelectMap }: BlockTypeModalProps) {
  const [mode, setMode] = useState<"menu" | "LINK" | "YOUTUBE" | "MAP">("menu");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // À l'intérieur d'un sous-écran (lien/image), Escape revient au menu —
      // sinon ferme carrément la pop-up.
      if (mode !== "menu") setMode("menu");
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const title =
    mode === "menu" ? "Ajouter une tuile" : mode === "MAP" ? "Ajouter une carte" : mode === "YOUTUBE" ? "Lien YouTube" : "Lien externe";

  const content = (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.16 }}
        className="fixed z-[71] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-xs bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden"
        style={{ maxHeight: "min(28rem, 80vh)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] flex-shrink-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Fermer"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {mode === "menu" && (
          <div className="p-2 grid grid-cols-3 gap-1">
            <BlockOption icon={Heading} label="Titre" onClick={() => onSelectSimple("title")} />
            <BlockOption icon={Pilcrow} label="Texte" onClick={() => onSelectSimple("note")} />
            <BlockOption icon={Quote} label="Citation" onClick={() => onSelectSimple("quote")} />
            <BlockOption icon={Mic} label="Audio" onClick={onSelectAudio} />
            <BlockOption icon={MapPin} label="Carte" onClick={() => setMode("MAP")} />
            <BlockOption icon={Link2} label="Lien externe" onClick={() => setMode("LINK")} />
            <BlockOption icon={Video} label="YouTube" onClick={() => setMode("YOUTUBE")} />
          </div>
        )}

        {(mode === "LINK" || mode === "YOUTUBE") && (
          <EmbedUrlForm kind={mode} onCancel={() => setMode("menu")} onSubmit={(url) => onSelectEmbed(mode, url)} />
        )}

        {mode === "MAP" && <MapForm onCancel={() => setMode("menu")} onSubmit={onSelectMap} />}
      </motion.div>
    </>
  );

  return createPortal(<AnimatePresence>{content}</AnimatePresence>, document.body);
}

// Recherche de lieu (Photon, voir PlaceAutocomplete.tsx) pour créer une tuile
// carte — distincte de la géoloc globale de la visite (Visit.latitude/
// longitude, carte de couverture).
function MapForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (locationName: string, latitude: number, longitude: number) => void;
}) {
  const [value, setValue] = useState("");
  const [geo, setGeo] = useState<PlaceGeo | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!geo || busy) return;
    setBusy(true);
    onSubmit(value.trim() || geo.address, geo.latitude, geo.longitude);
  };

  return (
    <div className="p-4 space-y-3">
      <PlaceAutocomplete
        value={value}
        onChange={(v) => { setValue(v); setGeo(null); }}
        onSelectGeo={setGeo}
        placeholder="Rechercher un lieu…"
        className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)]"
      />
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
          ← Retour
        </button>
        <button
          onClick={submit}
          disabled={!geo || busy}
          className="px-3.5 py-1.5 text-xs rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-40 transition-opacity"
        >
          {busy ? "Ajout…" : "Ajouter"}
        </button>
      </div>
    </div>
  );
}

function BlockOption({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 py-3 rounded-lg text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"
    >
      <Icon size={18} strokeWidth={1.75} />
      {label}
    </button>
  );
}

// Saisie d'URL pour créer un bloc lien/embed — même logique que l'ancien
// EmbedUrlInput (VisitJournal.tsx), juste restylé pour vivre dans le corps de
// la pop-up centrale au lieu d'un panneau flottant autonome.
function EmbedUrlForm({
  kind,
  onCancel,
  onSubmit,
}: {
  kind: "LINK" | "YOUTUBE";
  onCancel: () => void;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const valid = (() => {
    try {
      new URL(url.trim());
    } catch {
      return false;
    }
    return kind === "YOUTUBE" ? parseYouTubeId(url.trim()) !== null : /^https?:\/\//i.test(url.trim());
  })();

  const submit = () => {
    if (!valid || busy) return;
    setBusy(true);
    onSubmit(url.trim());
  };

  return (
    <div className="p-4 space-y-3">
      <input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={kind === "YOUTUBE" ? "https://youtube.com/watch?v=…" : "https://…"}
        className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)]"
      />
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
          ← Retour
        </button>
        <button
          onClick={submit}
          disabled={!valid || busy}
          className="px-3.5 py-1.5 text-xs rounded-lg bg-[var(--text-primary)] text-[var(--bg-base)] disabled:opacity-40 transition-opacity"
        >
          {busy ? "Ajout…" : "Ajouter"}
        </button>
      </div>
    </div>
  );
}
