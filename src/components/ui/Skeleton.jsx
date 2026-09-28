// Phase 2 polish: shimmer placeholders so pages never flash empty while loading.
export default function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-gray-200/80 ${className}`} />
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4, className = '' }) {
  return (
    <div className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-3 h-7 w-1/3" />
          <Skeleton className="mt-3 h-3 w-3/4" />
        </div>
      ))}
    </div>
  )
}

/** Full-screen placeholder shown while a lazily loaded page downloads. */
export function RouteSkeleton() {
  return (
    <div className="min-h-screen bg-cream-light" role="status" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <div className="fixed left-0 top-0 hidden h-full w-14 border-r border-gray-200 bg-white md:block" />
      <div className="md:ml-14">
        <div className="flex h-14 items-center border-b border-gray-200 bg-white px-5">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="space-y-6 p-4 sm:p-6">
          <SkeletonCards />
          <div className="rounded-2xl bg-white p-5 shadow-sm"><SkeletonText lines={5} /></div>
          <div className="rounded-2xl bg-white p-5 shadow-sm"><SkeletonText lines={4} /></div>
        </div>
      </div>
    </div>
  )
}
