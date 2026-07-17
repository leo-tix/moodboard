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

// Échelle typographique par format de tuile. Un titre rendu à la même petite
// taille quel que soit son format se perdait dans une tuile de 200px de haut
// (18px = 14% de la tuile) au lieu de la structurer (retour utilisateur
// 2026-07-17 : "mauvaise taille pour les titres"). La coupe (line-clamp) est
// indispensable ici : le texte étant centré verticalement, un titre long
// débordait des deux côtés à la fois et venait toucher les bords (mesuré :
// 196px de texte dans une tuile de 200px au format 1x1).
const TITLE_BY_SPAN: Record<string, string> = {
  "1x1": "text-xl leading-tight line-clamp-4",
  "2x1": "text-3xl leading-[1.15] line-clamp-3",
  "1x2": "text-2xl leading-tight line-clamp-[8]",
  "2x2": "text-4xl leading-[1.1] line-clamp-5",
};

const QUOTE_BY_SPAN: Record<string, string> = {
  "1x1": "text-sm line-clamp-5",
  "2x1": "text-base line-clamp-4",
  "1x2": "text-sm line-clamp-[9]",
  "2x2": "text-lg line-clamp-[8]",
};

interface TileContentProps {
  tile: BentoTile;
  /** true = carnet en édition (transcript audio éditable, image cliquable vers la bibliothèque) ; false = lecture seule (carnet public, sans session). */
  editable: boolean;
  /** Requis si editable — AudioBlockCard persiste son transcript via son propre crayon inline (pas le drawer, déjà un flux abouti). */
  onPersistAudioTranscript?: (audioId: string, transcript: string) => Promise<void>;
  /** Images du carnet, pour que la visionneuse ne parcoure (←/→) que CETTE visite. */
  imageNav?: ImageNavItem[];
}

// Rendu du CONTENU d'une tuile — pas de chrome (bordure/ombre/drag/bouton),
// c'est le rôle de BentoTile ("Widget Wrapper", spec §3.1). Une seule
// fonction pour l'éditeur ET le carnet public (readonly) : évite la
// duplication qui existait entre VisitJournal.tsx et VisitJournalReadOnly.tsx.
export function TileContent({ tile, editable, onPersistAudioTranscript, imageNav }: TileContentProps) {
  const author = useJournalAuthor();

  if (tile.content.type === "image") {
    const c = tile.content;
    const cartel = (c.title || c.author || c.year) && (
      // Vibrance (spec §5) : le texte posé sur une image passe par un fond
      // semi-transparent + flou pour rester lisible quelle que soit l'image.
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
        {cartel}
      </>
    );

    // Carnet public : pas de session, donc pas de lien vers /library.
    if (!editable) return <div className="relative w-full h-full bg-[var(--bg-surface)]">{picture}</div>;

    return (
      <Link
        href={`/library/${c.id}`}
        className="relative block w-full h-full bg-[var(--bg-surface)]"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: "none" }}
        onClick={() => {
          // Contexte de navigation de la visionneuse (←/→) — sans lui, ouvrir
          // une image du carnet retombe sur le repli "toute la bibliothèque".
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

  if (tile.content.type === "title") {
    return (
      <div className="w-full h-full flex items-center px-4 py-3 bg-[var(--bg-elevated)]">
        <p
          className={cn(
            "font-serif font-semibold text-[var(--text-primary)] tracking-tight hyphens-auto break-words",
            TITLE_BY_SPAN[`${tile.w}x${tile.h}`]
          )}
          lang="fr"
        >
          {tile.content.content || <span className="text-[var(--text-tertiary)] italic font-sans text-sm">Titre vide</span>}
        </p>
      </div>
    );
  }

  if (tile.content.type === "quote") {
    return (
      <div className="w-full h-full flex items-center gap-3 px-4 py-3 bg-[var(--bg-elevated)]">
        {/* Filet de citation en élément à part : posé en `border-l` sur la
            tuile, il était rogné par les coins arrondis (rounded-[20px]). */}
        <span className="w-0.5 self-stretch flex-shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
        <p className={cn("italic text-[var(--text-secondary)] leading-relaxed hyphens-auto break-words", QUOTE_BY_SPAN[`${tile.w}x${tile.h}`])} lang="fr">
          {tile.content.content || <span className="text-[var(--text-tertiary)] not-italic">Citation vide</span>}
        </p>
      </div>
    );
  }

  if (tile.content.type === "note") {
    return (
      <div className="w-full h-full overflow-hidden px-4 py-3 bg-[var(--bg-elevated)]">
        {/* Fondu plutôt que `line-clamp` (qui fonctionne pourtant ici) : une
            note est de la prose multi-blocs (h3 + paragraphes + listes) aux
            hauteurs de ligne hétérogènes, donc aucun nombre de lignes fixe ne
            tombe juste — il couperait trop tôt sur un texte simple et trop
            tard sur un sous-titre. Le masque s'arrête pile au bord de la
            tuile, quel que soit le contenu, et signale la suite par
            l'estompement. */}
        <div
          className="note-prose text-sm leading-relaxed h-full overflow-hidden"
          style={{
            maskImage: "linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%)",
          }}
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

  // embed — YouTube (iframe) ou lien externe (carte d'aperçu)
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
  // La carte de lien suit la FORME de la tuile : en 2x2 la vignette passe au
  //-dessus du texte (elle s'étirait sinon en bande verticale de 112px sur
  // toute la hauteur — audit 2026-07-17) ; en 2x1 elle reste sur le côté.
  const tall = tile.h === 2;
  return (
    <a
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "w-full h-full bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] transition-colors flex",
        tall ? "flex-col" : "items-stretch"
      )}
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
