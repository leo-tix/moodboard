import { getThumbnailUrl, getAudioUrl } from "@/lib/storage/urls";
import { AudioPlayer } from "@/components/visits/AudioPlayer";
import { AudioPlayerBoundary } from "@/components/visits/AudioPlayerBoundary";
import type { JournalItem, JournalBlock } from "@/components/visits/VisitJournal";

// Rendu LECTURE SEULE du carnet pour la page publique (Phase 5). Réutilise les
// mêmes types que l'éditeur (JournalItem) mais aucun composant interactif
// d'édition : les blocs texte/citation sont du HTML rendu tel quel via la CSS
// `.note-prose` (mêmes styles que l'éditeur), le titre reprend la police serif,
// l'audio réutilise le lecteur custom (avec son error boundary). Pas de drag,
// pas de menu, pas de lien vers /library (contenu public sans session).

const TITLE_STYLE = "font-serif text-3xl md:text-4xl font-semibold tracking-tight leading-[1.1] text-[var(--text-primary)]";

function ReadOnlyBlock({ block }: { block: JournalBlock }) {
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
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 space-y-1.5">
        <AudioPlayerBoundary src={getAudioUrl(block.storageKey)}>
          <AudioPlayer src={getAudioUrl(block.storageKey)} durationSec={block.durationSec} />
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

function ReadOnlyItem({ item }: { item: JournalItem }) {
  if (item.type === "columns") {
    return (
      <div className="col-span-full grid grid-cols-2 gap-3">
        <div className="space-y-3">
          {item.left.map((b) => (
            <ReadOnlyBlock key={`${b.type}-${b.id}`} block={b} />
          ))}
        </div>
        <div className="space-y-3">
          {item.right.map((b) => (
            <ReadOnlyBlock key={`${b.type}-${b.id}`} block={b} />
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
