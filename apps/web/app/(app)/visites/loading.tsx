import { Skeleton } from "@/components/ui/Skeleton";

// Le carnet de visite s'affiche par année, avec des cartes mosaïque (2×2) —
// squelette : un intitulé d'année + une rangée de grandes cartes.
export default function VisitesLoading() {
  return (
    <div className="p-4 md:p-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-7 w-52 rounded" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </header>

      {Array.from({ length: 2 }).map((_, group) => (
        <div key={group} className="mb-8">
          <Skeleton className="h-4 w-14 rounded mb-3" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
