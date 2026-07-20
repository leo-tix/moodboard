import { Skeleton } from "@/components/ui/Skeleton";

export default function CollectionDetailLoading() {
  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center gap-2 mb-6">
        <Skeleton className="h-3.5 w-24 rounded" />
      </div>
      <Skeleton className="h-7 w-56 rounded mb-5" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
      </div>
    </div>
  );
}
