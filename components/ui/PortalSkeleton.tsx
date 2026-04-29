interface PortalSkeletonProps {
  rows?: number
}

export function PortalSkeleton({ rows = 3 }: PortalSkeletonProps) {
  return (
    <div className="space-y-5" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-full bg-gray-100" />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="aspect-[4/3] animate-pulse rounded-xl bg-gray-100" />
            <div className="mt-4 h-4 w-3/4 animate-pulse rounded bg-gray-100" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
