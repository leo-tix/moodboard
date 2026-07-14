import { Skeleton, GridSkeleton } from "@/components/ui/Skeleton";

export default function SearchLoading() {
  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 md:mb-6 space-y-2">
        <Skeleton className="h-3 w-20 rounded" />
        <Skeleton className="h-8 w-48 rounded" />
        <Skeleton className="h-10 w-full max-w-xl rounded-lg mt-2" />
      </header>
      <div className="flex flex-col md:flex-row gap-4 md:gap-8">
        {/* Sidebar filtres — desktop */}
        <div className="hidden md:block w-56 flex-shrink-0 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <GridSkeleton count={12} />
        </div>
      </div>
    </div>
  );
}
