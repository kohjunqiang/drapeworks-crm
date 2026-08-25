import { Skeleton } from "@/components/ui/skeleton";

export default function OrderDetailLoading() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Skeleton className="h-3 w-32 mb-3" />
      {/* w-72 + w-20 side by side is wider than a phone; stack them until the
          row has the space, and let the subtitle shrink instead of pushing. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div className="min-w-0">
          <Skeleton className="h-7 w-48 mb-2" />
          <Skeleton className="h-4 w-full max-w-72" />
        </div>
        <Skeleton className="h-8 w-20 shrink-0" />
      </div>
      {/* The sidebar sits above the content on mobile, matching the real page. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-4 order-2 lg:order-1">
          <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 space-y-3">
            <Skeleton className="h-5 w-40 mb-2" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
        <div className="space-y-4 order-1 lg:order-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-slate-200 p-5 space-y-3"
            >
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
