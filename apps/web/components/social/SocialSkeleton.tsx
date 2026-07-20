import { Skeleton } from "@/components/ui/Skeleton";

// Squelette partagé par les surfaces sociales (fil / messagerie / réseau /
// notifications) : barre d'onglets + quelques lignes/cartes. Sert de fallback
// loading.tsx → retour visuel instantané au clic sur ces pages dynamiques.
export function SocialSkeleton({ variant = "list" }: { variant?: "list" | "feed" }) {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* Barre d'onglets */}
      <div className="flex items-center gap-4 border-b border-[var(--border-subtle)] mb-5 pb-2.5">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 w-20 rounded" />)}
      </div>
      {variant === "feed" ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
              <Skeleton className="w-full aspect-video rounded-none" />
              <div className="p-3 flex items-center gap-2.5">
                <Skeleton className="w-8 h-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/2 rounded" />
                  <Skeleton className="h-2.5 w-1/3 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3 rounded" />
                <Skeleton className="h-2.5 w-1/2 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
