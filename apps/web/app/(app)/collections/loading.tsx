import { Skeleton } from "@/components/ui/Skeleton";

export default function CollectionsLoading() {
  return (
    <div className="p-4 md:p-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-7 w-40 rounded" />
        </div>
        <Skeleton className="h-8 w-32 rounded-md" />
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-square rounded-xl" />
            <Skeleton className="h-3 w-2/3 rounded" />
            <Skeleton className="h-2.5 w-1/3 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
