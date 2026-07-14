"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Heading, Pilcrow, Quote, Mic, Columns2, Image as ImageIcon, Link2, Video, X, type LucideIcon } from "lucide-react";
import { parseYouTubeId } from "@/lib/visits/linkPreview";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { JournalImage } from "@/components/visits/VisitJournal";

// Pop-up UNIQUE de choix de type de bloc — remplace l'ancien InsertTypeMenu
// (petit menu ancré près du bouton cliqué, position différente selon le point
// d'entrée) et le picker inline des piles de colonnes. Centrée + voile flouté,
// IDENTIQUE mobile et desktop (demande explicite utilisateur 2026-07-14 :
// "simplifier au max l'ergonomie" — plus de logique d'ancrage/débordement
// d'écran à gérer par point d'entrée). Le "/" clavier de l'ancien bouton
// "+ Ajouter un bloc" est retiré au passage (redondant avec ce gros bouton
// toujours visible, cf. retour utilisateur).
//
// Un seul composant sert TOUS les points d'entrée (bouton "+" de fin de
// carnet, "⋯ Insérer un bloc après", "+" d'un slot de colonne vide) : les
// options Lien externe / YouTube / 2 colonnes ne sont proposées que pour une
// insertion top-level (`onSelectEmbed`/`onSelectColumns` fournis), l'option
// Image seulement pour remplir un slot de colonne (`onSelectImage` fourni).
interface BlockTypeModalProps {
  onClose: () => void;
  onSelectSimple: (type: "title" | "note" | "quote") => void;
  onSelectAudio: () => void;
  onSelectEmbed?: (kind: "LINK" | "YOUTUBE", url: string) => void;
  onSelectColumns?: () => void;
  onSelectImage?: (image: JournalImage) => void;
  visitImages?: JournalImage[];
}

export function BlockTypeModal({
  onClose,
  onSelectSimple,
  onSelectAudio,
  onSelectEmbed,
  onSelectColumns,
  onSelectImage,
  visitImages = [],
}: BlockTypeModalProps) {
  const [mode, setMode] = useState<"menu" | "LINK" | "YOUTUBE" | "image">("menu");

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
    mode === "menu" ? "Ajouter un bloc" : mode === "image" ? "Choisir une image" : mode === "YOUTUBE" ? "Lien YouTube" : "Lien externe";

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
            {onSelectImage && <BlockOption icon={ImageIcon} label="Image" onClick={() => setMode("image")} />}
            {onSelectColumns && <BlockOption icon={Columns2} label="2 colonnes" onClick={onSelectColumns} />}
            {onSelectEmbed && <BlockOption icon={Link2} label="Lien externe" onClick={() => setMode("LINK")} />}
            {onSelectEmbed && <BlockOption icon={Video} label="YouTube" onClick={() => setMode("YOUTUBE")} />}
          </div>
        )}

        {(mode === "LINK" || mode === "YOUTUBE") && onSelectEmbed && (
          <EmbedUrlForm kind={mode} onCancel={() => setMode("menu")} onSubmit={(url) => onSelectEmbed(mode, url)} />
        )}

        {mode === "image" && onSelectImage && (
          <div className="p-3 overflow-y-auto" style={{ maxHeight: "min(24rem, 70vh)" }}>
            {visitImages.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)] text-center py-8">Aucune image disponible dans cette visite.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {visitImages.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => onSelectImage(img)}
                    className="aspect-square rounded-md overflow-hidden bg-[var(--bg-surface)] hover:ring-2 hover:ring-[var(--text-primary)] transition-all"
                  >
                    {img.thumbnailKey && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={getThumbnailUrl(img.thumbnailKey)} alt="" className="w-full h-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </>
  );

  return createPortal(<AnimatePresence>{content}</AnimatePresence>, document.body);
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
