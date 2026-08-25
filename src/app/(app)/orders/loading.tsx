import { Skeleton } from "@/components/ui/skeleton";

export default function OrdersLoading() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Same shape as the real header: stacked on mobile, side by side from sm.
          Laid out inline at every width, the w-64 subtitle and the w-44 button
          added up to more than a phone is wide and scrolled the page. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="min-w-0">
          <Skeleton className="h-7 w-32 mb-2" />
          <Skeleton className="h-4 w-full max-w-64" />
        </div>
        <Skeleton className="h-9 w-full sm:w-44 shrink-0" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-lg border border-slate-200 p-3 sm:p-4"
          >
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>
      <Skeleton className="h-12 w-full mb-4" />
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </main>
  );
}
