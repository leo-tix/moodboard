import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnailUrl, getAudioUrl } from "@/lib/storage/urls";
import { parseYouTubeId } from "@/lib/visits/linkPreview";
import { AudioPlayer } from "@/components/visits/AudioPlayer";
import { AudioPlayerBoundary } from "@/components/visits/AudioPlayerBoundary";
import type { JournalItem, JournalBlock, JournalEmbed } from "@/components/visits/VisitJournal";

// Rendu LECTURE SEULE du carnet pour la page publique (Phase 5). Réutilise les
// mêmes types que l'éditeur (JournalItem) mais aucun composant interactif
// d'édition : les blocs texte/citation sont du HTML rendu tel quel via la CSS
// `.note-prose` (mêmes styles que l'éditeur), le titre reprend la police serif,
// l'audio réutilise le lecteur custom (avec son error boundary). Pas de drag,
// pas de menu, pas de lien vers /library (contenu public sans session).

const TITLE_STYLE = "font-serif text-3xl md:text-4xl font-semibold tracking-tight leading-[1.1] text-[var(--text-primary)]";

function ReadOnlyBlock({ block, compact = false }: { block: JournalBlock; compact?: boolean }) {
  if (block.type === "title") {
    return <h2 className={TITLE_STYLE}>{block.content}</h2>;
  }

  if (block.type === "note") {
    return <div className="note-prose text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: block.content }} />;
  }

  if (block.type === "quote") {
    // `.note-prose blockquote` est un sélecteur descendant (globals.css) — le
    // blockquote doit être ENFANT de .note-prose pour hériter du style citation.
    return (
      <div className="note-prose">
        <blockquote>
          <p>{block.content}</p>
        </blockquote>
      </div>
    );
  }

  if (block.type === "audio") {
    // compact : bloc DANS une pile de 2 colonnes (même raisonnement que
    // l'éditeur, voir AudioPlayer.tsx et VisitJournal.tsx) — sans lui, les
    // boutons ±15s + le libellé de temps fixe ne laissaient plus de place
    // à la waveform dans une colonne mobile étroite.
    return (
      <div className={cn("rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-1.5", compact ? "px-2 py-1.5" : "px-3 py-2")}>
        <AudioPlayerBoundary src={getAudioUrl(block.storageKey)}>
          <AudioPlayer src={getAudioUrl(block.storageKey)} durationSec={block.durationSec} compact={compact} />
        </AudioPlayerBoundary>
        {block.transcript && (
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{block.transcript}</p>
        )}
      </div>
    );
  }

  // image
  const ar = block.width && block.height ? block.width / block.height : 1;
  return (
    <figure>
      <div className="relative rounded-md overflow-hidden bg-[var(--bg-surface)]" style={{ aspectRatio: ar }}>
        {block.thumbnailKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getThumbnailUrl(block.thumbnailKey)}
            alt={block.title}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[var(--text-tertiary)] text-xs">—</span>
          </div>
        )}
      </div>
      {(block.title || block.author || block.year) && (
        <figcaption className="mt-1.5 px-0.5">
          {block.title && <p className="text-[12px] leading-snug text-[var(--text-secondary)]">{block.title}</p>}
          {(block.author || block.year) && (
            <p className="text-[11px] text-[var(--text-tertiary)] italic mt-0.5 truncate">
              {block.author}
              {block.author && block.year ? " · " : ""}
              {block.year ?? ""}
            </p>
          )}
        </figcaption>
      )}
    </figure>
  );
}

// Bloc lien externe (carte d'aperçu) / embed YouTube (iframe) en lecture seule.
function ReadOnlyEmbed({ embed }: { embed: JournalEmbed }) {
  const domain = (() => {
    try { return new URL(embed.url).hostname.replace(/^www\./, ""); } catch { return embed.url; }
  })();
  if (embed.kind === "YOUTUBE") {
    const videoId = parseYouTubeId(embed.url);
    return (
      <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
        {videoId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}`}
            title={embed.title ?? "YouTube"}
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
  return (
    <a
      href={embed.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-stretch rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden hover:border-[var(--border-default)] transition-colors"
    >
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center gap-1">
        <p className="text-sm font-medium text-[var(--text-primary)] line-clamp-1">{embed.title || domain}</p>
        {embed.description && (
          <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-snug">{embed.description}</p>
        )}
        <p className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5 truncate">
          <ExternalLink size={11} strokeWidth={1.75} /> {embed.siteName || domain}
        </p>
      </div>
      {embed.image && (
        <div className="w-28 sm:w-40 flex-shrink-0 bg-[var(--bg-surface)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={embed.image} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}
    </a>
  );
}

function ReadOnlyItem({ item }: { item: JournalItem }) {
  if (item.type === "embed") {
    return <div className="col-span-full"><ReadOnlyEmbed embed={item} /></div>;
  }

  if (item.type === "columns") {
    return (
      <div className="col-span-full grid grid-cols-2 gap-3">
        <div className="space-y-3">
          {item.left.map((b) => (
            <ReadOnlyBlock key={`${b.type}-${b.id}`} block={b} compact />
          ))}
        </div>
        <div className="space-y-3">
          {item.right.map((b) => (
            <ReadOnlyBlock key={`${b.type}-${b.id}`} block={b} compact />
          ))}
        </div>
      </div>
    );
  }

  // Les blocs texte (note/titre/citation/audio) occupent toute la largeur ;
  // les images s'inscrivent dans la grille (comme dans l'éditeur).
  const fullWidth = item.type !== "image";
  return <div className={fullWidth ? "col-span-full" : undefined}><ReadOnlyBlock block={item} /></div>;
}

export function VisitJournalReadOnly({ items }: { items: JournalItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--text-tertiary)] py-8 text-center">Ce carnet est vide.</p>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {items.map((item) => (
        <ReadOnlyItem key={`${item.type}-${item.id}`} item={item} />
      ))}
    </div>
  );
}
