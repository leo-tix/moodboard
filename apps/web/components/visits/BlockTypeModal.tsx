"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Type, Mic, MapPin, Link2, Video, Star, ListChecks, Milestone, Landmark, Ticket, Palette, BookOpen, PenLine, Loader2, X, type LucideIcon } from "lucide-react";
import { parseYouTubeId } from "@/lib/visits/linkPreview";
import { PlaceAutocomplete, type PlaceGeo } from "@/components/visits/PlaceAutocomplete";

// Pop-up UNIQUE de choix de type de tuile — grille bento (2026-07-15).
// Centrée + voile flouté, IDENTIQUE mobile et desktop (demande explicite
// utilisateur 2026-07-14 : "simplifier au max l'ergonomie" — plus de logique
// d'ancrage/débordement d'écran à gérer par point d'entrée). Un seul
// composant sert tous les points d'entrée du bouton "+ Ajouter" de la grille.
interface BlockTypeModalProps {
  onClose: () => void;
  /** Un seul module texte (titre/paragraphe/citation = formatage interne). */
  onSelectText: () => void;
  onSelectAudio: () => void;
  onSelectEmbed: (kind: "LINK" | "YOUTUBE", url: string) => void;
  onSelectMap: (locationName: string, latitude: number, longitude: number) => void;
  onSelectHighlight: () => void;
  onSelectChecklist: () => void;
  onSelectTimeline: () => void;
  onSelectCartel: () => void;
  onSelectTicket: () => void;
  onSelectPalette: () => void;
  /** Fiche wiki : `title` (page exacte choisie) OU `name` (recherche libre). */
  onSelectArtist: (payload: { title?: string; name?: string }) => void;
  onSelectSketch: () => void;
}

export function BlockTypeModal({ onClose, onSelectText, onSelectAudio, onSelectEmbed, onSelectMap, onSelectHighlight, onSelectChecklist, onSelectTimeline, onSelectCartel, onSelectTicket, onSelectPalette, onSelectArtist, onSelectSketch }: BlockTypeModalProps) {
  const [mode, setMode] = useState<"menu" | "LINK" | "YOUTUBE" | "MAP" | "ARTIST">("menu");

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
    mode === "menu" ? "Ajouter une tuile" : mode === "MAP" ? "Ajouter une carte" : mode === "ARTIST" ? "Fiche wiki" : mode === "YOUTUBE" ? "Lien YouTube" : "Lien externe";

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
          <div className="p-2 overflow-y-auto" style={{ maxHeight: "min(24rem, 68vh)" }}>
            {/* Sections thématiques : le catalogue s'étoffe (modules « musée »),
                on regroupe pour garder le choix lisible. */}
            <BlockSection label="Contenu">
              {/* Un seul module texte : titre, paragraphe et citation sont des
                  options de formatage à l'intérieur (fusion 2026-07-18). */}
              <BlockOption icon={Type} label="Texte" onClick={onSelectText} />
              <BlockOption icon={Mic} label="Audio" onClick={onSelectAudio} />
              <BlockOption icon={MapPin} label="Carte" onClick={() => setMode("MAP")} />
              <BlockOption icon={Link2} label="Lien externe" onClick={() => setMode("LINK")} />
              <BlockOption icon={Video} label="YouTube" onClick={() => setMode("YOUTUBE")} />
            </BlockSection>
            <BlockSection label="Musée">
              <BlockOption icon={Landmark} label="Cartel" onClick={onSelectCartel} />
              <BlockOption icon={Ticket} label="Billet" onClick={onSelectTicket} />
              <BlockOption icon={Palette} label="Palette" onClick={onSelectPalette} />
              <BlockOption icon={BookOpen} label="Fiche wiki" onClick={() => setMode("ARTIST")} />
              <BlockOption icon={PenLine} label="Croquis" onClick={onSelectSketch} />
              <BlockOption icon={Star} label="Coup de cœur" onClick={onSelectHighlight} />
            </BlockSection>
            <BlockSection label="Structure">
              <BlockOption icon={ListChecks} label="Checklist" onClick={onSelectChecklist} />
              <BlockOption icon={Milestone} label="Frise" onClick={onSelectTimeline} />
            </BlockSection>
          </div>
        )}

        {(mode === "LINK" || mode === "YOUTUBE") && (
          <EmbedUrlForm kind={mode} onCancel={() => setMode("menu")} onSubmit={(url) => onSelectEmbed(mode, url)} />
        )}

        {mode === "MAP" && <MapForm onCancel={() => setMode("menu")} onSubmit={onSelectMap} />}

        {mode === "ARTIST" && <WikiSearchForm onCancel={() => setMode("menu")} onSubmit={onSelectArtist} />}
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

// Recherche d'un artiste par nom → fiche Wikipédia (résolue côté serveur).
// Recherche Wikipédia FR avec AUTO-SUGGESTIONS (2026-07-19) : l'utilisateur
// tape, choisit la bonne page dans la liste (évite les homonymes / mauvaise
// résolution). Suggestions via l'API opensearch (CORS origin=*), côté client.
interface WikiSuggestion { title: string; desc: string }
function WikiSearchForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (p: { title?: string; name?: string }) => void }) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<WikiSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setSuggestions([]); setLoading(false); return; }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        // opensearch → [q, titres[], descriptions[], urls[]]
        const res = await fetch(
          `https://fr.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=6&namespace=0&format=json&origin=*`,
        );
        const data = (await res.json()) as [string, string[], string[], string[]];
        if (id !== reqId.current) return; // réponse obsolète
        const titles = data[1] ?? [];
        const descs = data[2] ?? [];
        setSuggestions(titles.map((title, i) => ({ title, desc: descs[i] ?? "" })));
      } catch {
        if (id === reqId.current) setSuggestions([]);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (title: string) => { if (busy) return; setBusy(true); onSubmit({ title }); };
  const submitFree = () => { const n = q.trim(); if (!n || busy) return; setBusy(true); onSubmit({ name: n }); };

  return (
    <div className="p-4 space-y-2">
      <div className="relative">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { if (suggestions[0]) pick(suggestions[0].title); else submitFree(); } }}
          placeholder="Rechercher sur Wikipédia (artiste, mouvement, lieu…)"
          className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)] placeholder:text-[var(--text-tertiary)]"
        />
        {loading && <Loader2 size={14} className="animate-spin absolute right-3 top-2.5 text-[var(--text-tertiary)]" />}
      </div>

      {suggestions.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
          {suggestions.map((s) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => pick(s.title)}
                disabled={busy}
                className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-50"
              >
                <p className="text-sm text-[var(--text-primary)] truncate">{s.title}</p>
                {s.desc && <p className="text-[11px] text-[var(--text-tertiary)] truncate">{s.desc}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-[var(--text-tertiary)]">Choisis la bonne page — nom, dates, notice et portrait sont repris de Wikipédia.</p>
      <div className="flex items-center justify-between gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">← Retour</button>
        {busy && <span className="text-xs text-[var(--text-tertiary)] flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Ajout…</span>}
      </div>
    </div>
  );
}

function BlockSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">{label}</p>
      <div className="grid grid-cols-3 gap-1">{children}</div>
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
