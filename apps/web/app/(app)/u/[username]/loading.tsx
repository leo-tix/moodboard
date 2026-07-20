import { Skeleton } from "@/components/ui/Skeleton";

export default function ProfileLoading() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-start gap-4">
        <Skeleton className="w-20 h-20 rounded-full" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-3.5 w-3/4 rounded" />
          <div className="pt-3 flex gap-2">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="mt-10 space-y-3">
        <Skeleton className="h-3 w-20 rounded" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}
