"use client";

import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/storage/urls";
import type { JournalTileContent } from "@/lib/visits/bentoTypes";

type CartelContent = Extract<JournalTileContent, { type: "cartel" }>;

// Tuile « cartel » — la fiche descriptive d'une œuvre, façon carton de musée.
// Photo optionnelle + champs structurés (titre / artiste / date / technique /
// dimensions / salle). S'adapte aux 4 formats : la photo occupe le haut (ou la
// gauche en format large), le texte suit.
export function CartelTile({ content, w, h }: { content: CartelContent; w: number; h: number }) {
  const hasPhoto = !!content.thumbnailKey;
  const wide = w === 2 && h === 1; // large → photo à gauche, texte à droite
  const compact = w === 1 && h === 1;

  const meta = [content.dateText, content.medium, content.dimensions].filter(Boolean).join(" · ");

  const text = (
    <div className={cn("min-w-0 flex flex-col justify-center", compact ? "p-2.5 gap-0.5" : "p-3.5 gap-1")}>
      {content.artist && (
        <p className={cn("uppercase tracking-wide text-[var(--text-tertiary)] truncate", compact ? "text-[9px]" : "text-[10px]")}>
          {content.artist}
        </p>
      )}
      <p className={cn("font-serif text-[var(--text-primary)] leading-tight break-words", compact ? "text-sm line-clamp-2" : "text-lg line-clamp-3")}>
        {content.artworkTitle || "Sans titre"}
      </p>
      {!compact && meta && (
        <p className="text-[11px] text-[var(--text-secondary)] italic leading-snug break-words mt-0.5">{meta}</p>
      )}
      {!compact && content.room && (
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1 truncate">Salle · {content.room}</p>
      )}
      {!compact && content.notes && h === 2 && (
        <p className="text-xs text-[var(--text-secondary)] leading-snug break-words mt-1.5 line-clamp-4">{content.notes}</p>
      )}
    </div>
  );

  if (!hasPhoto) {
    return <div className="w-full h-full bg-[var(--bg-elevated)] flex flex-col justify-center">{text}</div>;
  }

  const photo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getThumbnailUrl(content.thumbnailKey!)}
      alt={content.artworkTitle}
      loading="lazy"
      draggable={false}
      className="w-full h-full object-cover"
    />
  );

  if (compact) {
    // Carré : photo plein cadre + titre en surimpression.
    return (
      <div className="w-full h-full relative bg-[var(--bg-surface)]">
        {photo}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 px-2.5 py-2 bg-gradient-to-t from-black/75 to-transparent">
          <p className="font-serif text-[13px] text-white leading-tight line-clamp-2">{content.artworkTitle || "Sans titre"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full h-full bg-[var(--bg-elevated)] flex", wide ? "flex-row" : "flex-col")}>
      <div className={cn("bg-[var(--bg-surface)] overflow-hidden flex-shrink-0", wide ? "w-2/5 h-full" : "w-full h-1/2")}>
        {photo}
      </div>
      <div className="flex-1 min-w-0">{text}</div>
    </div>
  );
}
