"use client";

import Link from "next/link";
import { ExternalLink, Sprout, Cross, Flag, Briefcase, Brush, Shapes, Frame, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { parseYouTubeId } from "@/lib/visits/linkPreview";
import { AudioBlockCard } from "@/components/audio/AudioBlockCard";
import { useJournalAuthor } from "@/components/visits/JournalAuthorContext";
import { MapTile } from "@/components/visits/bento/MapTile";
import { HighlightTile } from "@/components/visits/bento/HighlightTile";
import { ChecklistTile } from "@/components/visits/bento/ChecklistTile";
import { TimelineTile } from "@/components/visits/bento/TimelineTile";
import { CartelTile } from "@/components/visits/bento/CartelTile";
import { TicketTile } from "@/components/visits/bento/TicketTile";
import { PaletteTile } from "@/components/visits/bento/PaletteTile";
import { SketchTile } from "@/components/visits/bento/SketchTile";
import type { BentoTile } from "@/lib/visits/bentoTypes";

export interface ImageNavItem {
  id: string;
  title: string;
  thumbnailKey: string | null;
}

// Dates de vie extraites du 1er paragraphe Wikipédia (« né le … 1840 … mort le
// … 1926 ») pour la carte fiche wiki. null si absent (mouvement, lieu, œuvre…).
function parseLifeDates(extract: string | null): string | null {
  if (!extract) return null;
  const birth = extract.match(/n[ée]e?\b[^.]{0,45}?\b(1[0-9]{3}|20[0-9]{2})/i)?.[1];
  const death = extract.match(/(?:mort|morte|décédée?|d[ée]c[èe]s|†)\b[^.]{0,45}?\b(1[0-9]{3}|20[0-9]{2})/i)?.[1];
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return `né·e en ${birth}`;
  return null;
}

interface TileContentProps {
  tile: BentoTile;
  /** true = carnet en édition ; false = lecture seule (carnet public, sans session). */
  editable: boolean;
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
  onToggleChecklistItem?: (checklistId: string, itemId: string) => void;
  imageNav?: ImageNavItem[];
}

// Rendu du CONTENU d'une tuile — pas de chrome (bordure/ombre/drag/bouton).
// Les blocs TEXTE sont rendus en hauteur naturelle, alignés en haut : la tuile
// est dimensionnée par BentoTile pour tout afficher (auto-hauteur), donc plus
// de coupe ni de centrage (qui rognait le texte des deux côtés). Le fond des
// tuiles texte est porté par BentoTile.
export function TileContent({ tile, editable, onPersistAudioTranscript, onToggleChecklistItem, imageNav }: TileContentProps) {
  const author = useJournalAuthor();

  // Séparateur de section : ligne pleine largeur + puce centrée (multi-ligne si
  // le titre est long — 2026-07-19).
  if (tile.content.type === "separator") {
    const label = tile.content.label.trim() || "Section";
    return (
      <div className="w-full h-full flex items-center gap-3 px-1">
        <span className="h-px flex-1 bg-[var(--border-default)]" />
        <span className="shrink-0 max-w-[80%] text-center px-4 py-2 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[13px] font-medium text-[var(--text-primary)] tracking-wide leading-snug break-words">
          {label}
        </span>
        <span className="h-px flex-1 bg-[var(--border-default)]" />
      </div>
    );
  }

  if (tile.content.type === "image") {
    const c = tile.content;
    // Cartel masquable par tuile (retour utilisateur 2026-07-19 : choisir
    // d'afficher le titre ou non).
    const cartel = !tile.hideTitle && (c.title || c.author || c.year) && (
      <div className="pointer-events-none absolute bottom-0 inset-x-0 px-2.5 py-2 backdrop-blur-md bg-gradient-to-t from-black/70 to-transparent">
        {c.title && <p className="text-[12px] font-medium text-white truncate">{c.title}</p>}
        {(c.author || c.year) && (
          <p className="text-[10px] text-white/70 italic truncate">
            {c.author}
            {c.author && c.year ? " · " : ""}
            {c.year ?? ""}
          </p>
        )}
      </div>
    );
    const picture = (
      <>
        {c.thumbnailKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={getThumbnailUrl(c.thumbnailKey)} alt={c.title} loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[var(--text-tertiary)] text-xs">—</span>
          </div>
        )}
        {cartel}
      </>
    );
    if (!editable) return <div className="relative w-full h-full bg-[var(--bg-surface)]">{picture}</div>;
    return (
      <Link
        href={`/library/${c.id}`}
        className="relative block w-full h-full bg-[var(--bg-surface)]"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: "none" }}
        onClick={() => {
          try {
            sessionStorage.setItem("moodboard:libraryNav", JSON.stringify({ items: imageNav ?? [] }));
          } catch {
            // sessionStorage indisponible
          }
        }}
      >
        {picture}
      </Link>
    );
  }

  if (tile.content.type === "note") {
    // Module texte unique : le HTML peut contenir titre (h1), sous-titre (h2),
    // intertitre (h3), citation (blockquote), listes… tous stylés par .note-prose.
    return (
      <div className="px-4 py-3">
        <div
          className="note-prose text-sm leading-relaxed break-words"
          dangerouslySetInnerHTML={{ __html: tile.content.content || "<p class='text-[var(--text-tertiary)] italic'>Texte vide</p>" }}
        />
      </div>
    );
  }

  if (tile.content.type === "audio") {
    const c = tile.content;
    // Karaoké seulement en grand format (2x2) : en dessous les mots qui
    // défilent sont illisibles (demande utilisateur 2026-07-18).
    const transcriptVisible = tile.w === 2 && tile.h === 2;
    return (
      <AudioBlockCard
        storageKey={c.storageKey}
        durationSec={c.durationSec}
        transcript={c.transcript}
        authorName={author.name}
        authorImage={author.image}
        editable={editable}
        transcriptVisible={transcriptVisible}
        dense={tile.h === 1}
        onPersistTranscript={editable ? (text) => onPersistAudioTranscript!(c.id, text) : undefined}
        className="w-full h-full"
      />
    );
  }

  if (tile.content.type === "map") {
    const c = tile.content;
    return <MapTile locationName={c.locationName} latitude={c.latitude} longitude={c.longitude} className="w-full h-full" />;
  }

  if (tile.content.type === "highlight") {
    return <HighlightTile content={tile.content} w={tile.w} h={tile.h} />;
  }

  if (tile.content.type === "checklist") {
    const c = tile.content;
    return <ChecklistTile content={c} editable={editable} onToggle={editable && onToggleChecklistItem ? (itemId) => onToggleChecklistItem(c.id, itemId) : undefined} />;
  }

  if (tile.content.type === "timeline") {
    return <TimelineTile content={tile.content} />;
  }

  if (tile.content.type === "cartel") {
    return <CartelTile content={tile.content} />;
  }

  if (tile.content.type === "ticket") {
    return <TicketTile content={tile.content} w={tile.w} h={tile.h} />;
  }

  if (tile.content.type === "palette") {
    return <PaletteTile content={tile.content} w={tile.w} h={tile.h} />;
  }

  if (tile.content.type === "sketch") {
    return <SketchTile content={tile.content} />;
  }

  // embed — YouTube (iframe) ou lien externe / fiche artiste (carte d'aperçu)
  if (tile.content.type === "embed") {
    const c = tile.content;
    if (c.kind === "YOUTUBE") {
      const videoId = parseYouTubeId(c.url);
      return (
        <div className="w-full h-full bg-black">
          {videoId ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}`}
              title={c.title ?? "YouTube"}
              className="w-full h-full"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[var(--text-tertiary)] text-xs">Vidéo indisponible</div>
          )}
        </div>
      );
    }

    // Fiche wiki (Wikipédia) — carte d'IDENTITÉ à hauteur automatique. Portrait
    // au ratio d'origine (à gauche en format Large, centré au-dessus en format
    // Normal), infobox structurée (Wikidata) à icônes, puis résumé de l'article.
    // Chaque bloc (portrait / infos / résumé) est masquable via les réglages.
    if (c.kind === "ARTIST") {
      const d = c.data ?? null;
      const rows: { label: string; value: string; Icon: LucideIcon }[] = [];
      const join = (a?: string[]) => (a && a.length ? a.join(", ") : "");
      const dateAndPlace = (x?: { date?: string; place?: string }) =>
        x ? [x.date, x.place ? `à ${x.place}` : ""].filter(Boolean).join(" ") : "";
      if (d) {
        const b = dateAndPlace(d.birth); if (b) rows.push({ label: "Naissance", value: b, Icon: Sprout });
        const dt = dateAndPlace(d.death); if (dt) rows.push({ label: "Décès", value: dt, Icon: Cross });
        const nat = join(d.nationality); if (nat) rows.push({ label: "Nationalité", value: nat, Icon: Flag });
        const occ = join(d.occupation); if (occ) rows.push({ label: "Activité", value: occ, Icon: Briefcase });
        const mov = join(d.movement); if (mov) rows.push({ label: "Mouvement", value: mov, Icon: Brush });
        const gen = join(d.genre); if (gen) rows.push({ label: "Genres", value: gen, Icon: Shapes });
        const wk = join(d.notableWorks); if (wk) rows.push({ label: "Œuvres notables", value: wk, Icon: Frame });
      }
      const stacked = tile.w === 1; // format Normal (1 colonne) → image au-dessus
      const showImage = !!c.image && !tile.hideImage;
      const showInfo = !tile.hideInfo && rows.length > 0;
      const showParagraph = !tile.hideParagraph && !!c.description;
      // Repli sur les dates parsées du texte si aucune infobox affichée.
      const fallbackLife = !tile.hideInfo && rows.length === 0 ? parseLifeDates(c.description) : null;

      return (
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "w-full flex bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] transition-colors",
            stacked ? "flex-col" : "flex-row items-stretch"
          )}
        >
          {showImage && (
            <div className={cn("shrink-0", stacked ? "pt-3 px-3 flex justify-center" : "self-start pl-3 py-3")}>
              {/* Ratio d'origine préservé (h-auto), marge + coins arrondis. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.image!}
                alt={c.title ?? ""}
                className={cn("h-auto block rounded-xl bg-[var(--bg-surface)]", stacked ? "w-full max-w-[180px]" : "w-[100px] sm:w-[116px]")}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
          <div className="min-w-0 flex-1 px-3.5 py-3 flex flex-col gap-1.5">
            <div>
              <p className="font-serif text-[15px] text-[var(--text-primary)] leading-tight break-words">{c.title || "Fiche"}</p>
              {c.siteName && <p className="text-[11px] text-[var(--text-secondary)] italic leading-snug mt-0.5">{c.siteName}</p>}
              {fallbackLife && <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mt-0.5">{fallbackLife}</p>}
            </div>
            {showInfo && (
              <dl className="mt-0.5 space-y-1.5">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-start gap-2">
                    <r.Icon size={13} strokeWidth={1.75} className="text-[var(--text-tertiary)] shrink-0 mt-[3px]" />
                    <div className="min-w-0 flex-1">
                      <dt className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)] leading-none">{r.label}</dt>
                      <dd className="text-[12px] text-[var(--text-primary)] leading-snug break-words mt-[1px]">{r.value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            )}
            {showParagraph && (
              <p className={cn("text-[12px] text-[var(--text-secondary)] leading-relaxed", showInfo && "mt-1 pt-2 border-t border-[var(--border-subtle)]")}>
                {c.description}
              </p>
            )}
            <p className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1 mt-1">
              <ExternalLink size={10} strokeWidth={1.75} /> Wikipédia
            </p>
          </div>
        </a>
      );
    }

    const domain = (() => {
      try { return new URL(c.url).hostname.replace(/^www\./, ""); } catch { return c.url; }
    })();
    const tall = tile.h === 2;
    return (
      <a
        href={c.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("w-full h-full bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] transition-colors flex", tall ? "flex-col" : "items-stretch")}
      >
        {c.image && (
          <div className={cn("flex-shrink-0 bg-[var(--bg-surface)] overflow-hidden", tall ? "w-full flex-1 order-first" : "w-28 order-last")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.image} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          </div>
        )}
        <div className={cn("min-w-0 px-4 py-3 flex flex-col justify-center gap-1", tall ? "flex-shrink-0" : "flex-1")}>
          <p className={cn("text-sm font-medium text-[var(--text-primary)]", tall ? "line-clamp-2" : "line-clamp-1")}>{c.title || domain}</p>
          {c.description && <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-snug">{c.description}</p>}
          <p className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5 truncate">
            <ExternalLink size={11} strokeWidth={1.75} /> {c.siteName || domain}
          </p>
        </div>
      </a>
    );
  }

  // Tous les types de tuile sont désormais gérés ci-dessus (union exhaustive) —
  // `tile.content` est de type `never` ici, ce return n'est jamais atteint.
  return null;
}
