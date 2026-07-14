import { Skeleton, GridSkeleton } from "@/components/ui/Skeleton";

// Squelette de chargement de la bibliothèque — reprend le gabarit de la page
// (en-tête "Archive" + titre + grille d'images) pour un fondu vers le contenu
// réel sans saut de mise en page.
export default function LibraryLoading() {
  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-7 w-40 rounded" />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </header>
      <GridSkeleton count={15} />
    </div>
  );
}
