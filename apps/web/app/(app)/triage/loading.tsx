import { Skeleton } from "@/components/ui/Skeleton";

// Le triage est une pile de cartes à balayer (plein écran) — squelette :
// barre du haut + carte centrée + rangée de boutons d'action.
export default function TriageLoading() {
  return (
    <div className="flex flex-col h-screen">
      {/* Barre du haut */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-[var(--border-subtle)]">
        <Skeleton className="h-4 w-28 rounded" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>

      {/* Zone carte */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4 min-h-0">
        <div className="w-full" style={{ maxWidth: "min(100%, 380px)" }}>
          <Skeleton className="aspect-[3/4] rounded-2xl" />
        </div>
        <div className="flex items-center gap-3 w-full" style={{ maxWidth: "min(100%, 380px)" }}>
          <Skeleton className="flex-1 h-14 rounded-2xl" />
          <Skeleton className="w-14 h-14 rounded-2xl flex-shrink-0" />
          <Skeleton className="flex-1 h-14 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
