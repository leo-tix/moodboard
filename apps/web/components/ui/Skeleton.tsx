import { cn } from "@/lib/utils";

// Bloc de chargement générique — surface neutre + balayage lumineux
// (.skeleton, voir globals.css). Composant serveur pur (pas de state) :
// utilisable directement dans les fichiers loading.tsx (Suspense fallback).
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

// Grille d'images en chargement — reprend les breakpoints de la grille réelle
// (InspirationGrid : 2 / 3 / 4 / 5 colonnes) avec des tuiles d'aspect varié
// pour éviter l'effet "damier" trop régulier.
export function GridSkeleton({ count = 12 }: { count?: number }) {
  const ratios = ["aspect-square", "aspect-[3/4]", "aspect-[4/3]", "aspect-[4/5]"];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={ratios[i % ratios.length]} />
      ))}
    </div>
  );
}
