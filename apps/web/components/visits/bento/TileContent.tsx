"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import { parseYouTubeId } from "@/lib/visits/linkPreview";
import { AudioBlockCard } from "@/components/audio/AudioBlockCard";
import { useJournalAuthor } from "@/components/visits/JournalAuthorContext";
import { MapTile } from "@/components/visits/bento/MapTile";
import type { BentoTile } from "@/lib/visits/bentoTypes";

interface TileContentProps {
  tile: BentoTile;
  /** true = carnet en édition (transcript audio éditable) ; false = lecture seule (carnet public). */
  editable: boolean;
  /** Requis si editable — AudioBlockCard persiste son transcript via son propre crayon inline (pas le drawer, déjà un flux abouti). */
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
}

// Rendu du CONTENU d'une tuile — pas de chrome (bordure/ombre/drag), c'est le
// rôle de BentoTile ("Widget Wrapper", spec §3.1). Une seule fonction pour
// l'éditeur ET le carnet public (readonly) : évite la duplication qui
// existait entre VisitJournal.tsx et VisitJournalReadOnly.tsx pour les cartes
// embed notamment.
export function TileContent({ tile, editable, onPersistAudioTranscript }: TileContentProps) {
  const author = useJournalAuthor();

  if (tile.content.type === "image") {
    const c = tile.content;
    return (
      <div className="relative w-full h-full bg-[var(--bg-surface)]">
        {c.thumbnailKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getThumbnailUrl(c.thumbnailKey)}
            alt={c.title}
            loading="lazy"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[var(--text-tertiary)] text-xs">—</span>
          </div>
        )}
        {(c.title || c.author || c.year) && (
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
        )}
      </div>
    );
  }

  if (tile.content.type === "title") {
    return (
      <div className="w-full h-full flex items-center px-4 py-3">
        <p
          className={cn(
            "font-serif font-semibold text-[var(--text-primary)] leading-tight",
            tile.h === 2 ? "text-2xl line-clamp-6" : "text-lg line-clamp-2"
          )}
        >
          {tile.content.content || <span className="text-[var(--text-tertiary)] italic font-sans text-sm">Titre vide</span>}
        </p>
      </div>
    );
  }

  if (tile.content.type === "quote") {
    return (
      <div className="w-full h-full flex items-center px-4 py-3 border-l-2 border-[var(--accent)] bg-[var(--bg-elevated)]">
        <p className={cn("italic text-[var(--text-secondary)] leading-relaxed", tile.h === 2 ? "text-base line-clamp-[10]" : "text-sm line-clamp-3")}>
          {tile.content.content || <span className="text-[var(--text-tertiary)] not-italic">Citation vide</span>}
        </p>
      </div>
    );
  }

  if (tile.content.type === "note") {
    return (
      <div className="w-full h-full overflow-hidden px-4 py-3 bg-[var(--bg-elevated)]">
        <div
          className={cn("note-prose text-sm leading-relaxed", tile.h === 2 ? "line-clamp-[14]" : "line-clamp-4")}
          dangerouslySetInnerHTML={{ __html: tile.content.content || "<p class='text-[var(--text-tertiary)] italic'>Note vide</p>" }}
        />
      </div>
    );
  }

  if (tile.content.type === "audio") {
    const c = tile.content;
    return (
      <AudioBlockCard
        storageKey={c.storageKey}
        durationSec={c.durationSec}
        transcript={c.transcript}
        authorName={author.name}
        authorImage={author.image}
        editable={editable}
        onPersistTranscript={editable ? (text) => onPersistAudioTranscript!(c.id, text) : undefined}
        className="w-full h-full"
      />
    );
  }

  if (tile.content.type === "map") {
    const c = tile.content;
    return <MapTile locationName={c.locationName} latitude={c.latitude} longitude={c.longitude} className="w-full h-full" />;
  }

  // embed — YouTube (iframe lazy) ou lien externe (carte d'aperçu)
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
  return (
    <a
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-stretch w-full h-full bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] transition-colors"
      onClick={(e) => { if (editable) e.preventDefault(); }}
    >
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center gap-1">
        <p className="text-sm font-medium text-[var(--text-primary)] line-clamp-1">{c.title || domain}</p>
        {c.description && <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-snug">{c.description}</p>}
        <p className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5 truncate">
          <ExternalLink size={11} strokeWidth={1.75} /> {c.siteName || domain}
        </p>
      </div>
      {c.image && (
        <div className="w-28 flex-shrink-0 bg-[var(--bg-surface)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.image} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}
    </a>
  );
}
