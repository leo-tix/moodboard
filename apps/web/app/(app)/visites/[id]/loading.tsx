import { Skeleton } from "@/components/ui/Skeleton";

// Détail d'une visite (carnet bento) : barre du haut + grande cover + grille de
// tuiles de formats variés.
export default function VisiteDetailLoading() {
  return (
    <div className="max-w-4xl mx-auto px-4 pb-6 md:px-6 md:pt-6">
      <div className="flex items-center justify-between py-3">
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <Skeleton className="w-full aspect-[21/9] rounded-2xl mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {["row-span-2", "", "", "row-span-2", "", ""].map((span, i) => (
          <Skeleton key={i} className={`rounded-[20px] ${span || "aspect-square"} ${span ? "aspect-[3/4]" : ""}`} />
        ))}
      </div>
    </div>
  );
}
