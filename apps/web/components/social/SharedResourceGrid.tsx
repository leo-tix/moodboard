import Link from "next/link";
import { UserAvatar } from "@/components/social/UserAvatar";
import { BoardThumb } from "@/components/moodboard/BoardThumb";

export type SharedItem = {
  id: string;
  href: string;
  title: string;
  cover: string | null;
  board: { previewKey: string | null; background: string } | null;
  owner: { name: string | null; username: string | null; image: string | null };
};

// Grille « Partagé avec moi » : ressources d'autres membres accessibles au
// visiteur (grant / connexions / public). Vignette fidèle + byline auteur.
export function SharedResourceGrid({ items, emptyLabel }: { items: SharedItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--text-tertiary)] py-12 text-center">{emptyLabel}</p>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className="block rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden hover:border-[var(--border-default)] transition-colors">
          {it.board ? (
            <BoardThumb previewKey={it.board.previewKey} title={it.title} background={it.board.background} />
          ) : it.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.cover} alt="" className="w-full aspect-video object-cover" />
          ) : (
            <div className="w-full aspect-video flex items-center justify-center bg-[var(--bg-elevated)]">
              <span className="text-[var(--text-tertiary)] text-xs opacity-40 px-2 truncate">{it.title}</span>
            </div>
          )}
          <div className="p-2.5">
            <p className="text-xs text-[var(--text-primary)] truncate">{it.title}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <UserAvatar name={it.owner.name} username={it.owner.username} image={it.owner.image} size={16} />
              <span className="text-[10px] text-[var(--text-tertiary)] truncate">{it.owner.name || `@${it.owner.username}`}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
