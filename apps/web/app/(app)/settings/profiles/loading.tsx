import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsProfilesLoading() {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <Skeleton className="h-7 w-48 rounded mb-4" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-subtle)]">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3 rounded" />
            <Skeleton className="h-2.5 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
