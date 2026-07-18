"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { parseYouTubeId } from "@/lib/visits/linkPreview";
import { AudioBlockCard } from "@/components/audio/AudioBlockCard";
import { useJournalAuthor } from "@/components/visits/JournalAuthorContext";
import { MapTile } from "@/components/visits/bento/MapTile";
import type { BentoTile } from "@/lib/visits/bentoTypes";

export interface ImageNavItem {
  id: string;
  title: string;
  thumbnailKey: string | null;
}

interface TileContentProps {
  tile: BentoTile;
  /** true = carnet en édition ; false = lecture seule (carnet public, sans session). */
  editable: boolean;
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
  imageNav?: ImageNavItem[];
}

// Rendu du CONTENU d'une tuile — pas de chrome (bordure/ombre/drag/bouton).
// Les blocs TEXTE sont rendus en hauteur naturelle, alignés en haut : la tuile
// est dimensionnée par BentoTile pour tout afficher (auto-hauteur), donc plus
// de coupe ni de centrage (qui rognait le texte des deux côtés). Le fond des
// tuiles texte est porté par BentoTile.
export function TileContent({ tile, editable, onPersistAudioTranscript, imageNav }: TileContentProps) {
  const author = useJournalAuthor();

  if (tile.content.type === "image") {
    const c = tile.content;
    const cartel = (c.title || c.author || c.year) && (
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

  // Modules « musée » (2026-07-18) — rendus branchés phase par phase. Filet
  // de sécurité en attendant : aucun de ces types n'est créable tant que son
  // entrée n'est pas ajoutée à BlockTypeModal, donc ceci ne s'affiche jamais
  // en pratique — il garantit juste l'exhaustivité de type de l'union.
  return (
    <div className="w-full h-full flex items-center justify-center bg-[var(--bg-elevated)]">
      <span className="text-[var(--text-tertiary)] text-xs">Module « {tile.content.type} »</span>
    </div>
  );
}
