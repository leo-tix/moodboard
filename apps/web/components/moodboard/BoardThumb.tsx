import { getImageUrl } from "@/lib/storage/urls";

// Vignette d'une planche pour les LISTES (feed, grille, profil, message) : utilise
// l'aperçu précalculé R2 (previewKey) → aucune lecture de canvasData (economie
// d'egress DB). Repli sur un aplat titré si l'aperçu n'existe pas encore.
export function BoardThumb({ previewKey, title, background, className = "w-full aspect-video object-cover" }: { previewKey: string | null; title: string; background: string; className?: string }) {
  if (previewKey) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={getImageUrl(previewKey)} alt={title} loading="lazy" draggable={false} className={className} />;
  }
  return (
    <div className={`${className} flex items-center justify-center`} style={{ backgroundColor: background }}>
      <span className="text-[var(--text-tertiary)] text-xs opacity-40 px-2 truncate">{title}</span>
    </div>
  );
}
