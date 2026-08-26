import { Skeleton } from './Skeleton'

function SkeletonLine({ className }: { className: string }) {
  return <Skeleton className={className} />
}

function ProductCardSkeleton() {
  return (
    <article className="rounded-3xl bg-white p-3">
      <div className="aspect-square w-full animate-pulse rounded-2xl bg-gray-100" />
      <div className="mt-3 px-2 pb-1">
        <div className="grid grid-cols-3 gap-4">
          <SkeletonLine className="h-2 w-14" />
          <SkeletonLine className="h-2 w-10" />
          <SkeletonLine className="h-2 w-12" />
          <SkeletonLine className="h-3 w-20" />
          <SkeletonLine className="h-3 w-16" />
          <SkeletonLine className="h-3 w-14" />
        </div>
        <div className="mt-3 flex gap-1">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-2.5 w-2.5 animate-pulse rounded-full bg-gray-100"
            />
          ))}
        </div>
      </div>
    </article>
  )
}

function TrackerCardSkeleton() {
  return (
    <div className="rounded-3xl bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonLine className="h-4 w-40" />
          <SkeletonLine className="h-3 w-56 max-w-full" />
          <SkeletonLine className="h-3 w-28" />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <SkeletonLine className="h-4 w-24" />
          <div className="flex gap-2">
            <SkeletonLine className="h-7 w-20" />
            <SkeletonLine className="h-7 w-24" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
        <SkeletonLine className="h-3 w-40" />
        <SkeletonLine className="h-7 w-28" />
      </div>
      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="flex items-center gap-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-1.5 flex-1 animate-pulse rounded-full bg-gray-100" />
          ))}
        </div>
        <div className="mt-3 flex justify-between">
          <SkeletonLine className="h-2 w-12" />
          <SkeletonLine className="h-2 w-14" />
          <SkeletonLine className="h-2 w-16" />
        </div>
      </div>
    </div>
  )
}

function QuoteCardSkeleton() {
  return (
    <div className="rounded-3xl bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonLine className="h-4 w-40" />
          <SkeletonLine className="h-3 w-64 max-w-full" />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <SkeletonLine className="h-4 w-24" />
          <SkeletonLine className="h-5 w-20" />
        </div>
      </div>
      <div className="mt-3 border-t border-gray-100 pt-3">
        <SkeletonLine className="h-3 w-32" />
      </div>
    </div>
  )
}

export function CatalogueRouteSkeleton() {
  return (
    <div className="min-h-screen bg-white" aria-label="Loading catalogue">
      <div className="mx-auto max-w-[1680px] px-4 pb-16 pt-3 md:px-8 md:pt-4">
        <div className="mb-4 flex items-center gap-3 md:mb-6">
          <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />
          <SkeletonLine className="h-4 w-40" />
        </div>
        <div className="mt-4 md:hidden">
          <SkeletonLine className="h-9 w-28" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:mt-6 md:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function ProductDetailRouteSkeleton() {
  return (
    <div className="min-h-screen bg-white" aria-label="Loading product">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-3 md:px-6 md:pt-4">
        <div className="mb-4 flex items-center gap-3 md:mb-6">
          <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />
          <SkeletonLine className="h-4 w-56" />
        </div>
        <div className="mt-6 grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
          <div className="rounded-[32px] bg-white p-4 md:p-6">
            <div className="aspect-square animate-pulse rounded-3xl bg-gray-100" />
            <div className="mt-4 flex gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-16 w-16 animate-pulse rounded-2xl bg-gray-100" />
              ))}
            </div>
          </div>
          <div className="space-y-8">
            <header>
              <SkeletonLine className="h-3 w-20" />
              <SkeletonLine className="mt-3 h-12 w-3/4" />
              <SkeletonLine className="mt-4 h-4 w-full max-w-lg" />
              <SkeletonLine className="mt-2 h-4 w-2/3" />
              <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <SkeletonLine className="h-2 w-20" />
                    <SkeletonLine className="h-3 w-28" />
                  </div>
                ))}
              </div>
            </header>
            <div className="rounded-[24px] bg-white p-6">
              <SkeletonLine className="h-3 w-28" />
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <SkeletonLine key={index} className="h-4 w-28" />
                ))}
              </div>
            </div>
            <div className="rounded-[24px] bg-white p-6">
              <div className="flex items-end justify-between gap-5">
                <div className="space-y-2">
                  <SkeletonLine className="h-3 w-20" />
                  <SkeletonLine className="h-10 w-28" />
                </div>
                <div className="space-y-2">
                  <SkeletonLine className="h-4 w-32" />
                  <SkeletonLine className="h-3 w-24" />
                </div>
              </div>
              <SkeletonLine className="mt-6 h-11 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function OrderTrackerRouteSkeleton() {
  return (
    <div className="min-h-screen bg-white" aria-label="Loading tracker">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <SkeletonLine className="h-14 w-56" />
          <SkeletonLine className="mt-4 h-4 w-80 max-w-full" />
        </header>
        <div className="mb-8 grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-3xl bg-white p-5">
              <SkeletonLine className="h-3 w-20" />
              <SkeletonLine className="mt-3 h-8 w-12" />
            </div>
          ))}
        </div>
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <SkeletonLine className="h-10 flex-1" />
          <SkeletonLine className="h-10 w-44" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <TrackerCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function PastOrdersRouteSkeleton() {
  return (
    <div className="min-h-screen bg-white" aria-label="Loading orders">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="mb-10 md:mb-12">
          <SkeletonLine className="h-14 w-44" />
          <SkeletonLine className="mt-4 h-4 w-96 max-w-full" />
        </header>
        <div className="mb-6 flex">
          <SkeletonLine className="h-10 w-44" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <QuoteCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function CollectionDetailRouteSkeleton() {
  return (
    <div className="min-h-screen bg-white" aria-label="Loading order">
      <div className="mx-auto max-w-7xl space-y-6 px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3">
            <SkeletonLine className="h-7 w-72 max-w-full" />
            <SkeletonLine className="h-3 w-56" />
          </div>
          <SkeletonLine className="h-10 w-32" />
        </div>
        <div className="rounded-3xl bg-white p-6">
          <SkeletonLine className="h-4 w-36" />
          <SkeletonLine className="mt-4 h-3 w-full" />
          <SkeletonLine className="mt-2 h-3 w-2/3" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-3xl bg-white p-4">
              <div className="aspect-square animate-pulse rounded-2xl bg-gray-100" />
              <SkeletonLine className="mt-4 h-4 w-32" />
              <SkeletonLine className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AccountRouteSkeleton() {
  return (
    <div className="min-h-screen bg-white" aria-label="Loading account">
      <div className="mx-auto max-w-[1320px] px-6 pb-16 pt-[120px]">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="mb-10 md:mb-12">
            <SkeletonLine className="h-14 w-64" />
          </header>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-3xl bg-white p-6">
              <SkeletonLine className="h-5 w-44" />
              <div className="mt-5 space-y-4">
                <SkeletonLine className="h-3 w-20" />
                <SkeletonLine className="h-4 w-40" />
                <SkeletonLine className="h-3 w-20" />
                <SkeletonLine className="h-4 w-56" />
              </div>
            </div>
            <div className="rounded-3xl bg-white p-6">
              <SkeletonLine className="h-5 w-40" />
              <div className="mt-5 space-y-3">
                <SkeletonLine className="h-4 w-36" />
                <SkeletonLine className="h-3 w-64 max-w-full" />
                <SkeletonLine className="h-3 w-48" />
              </div>
            </div>
          </div>
          <div className="rounded-3xl bg-white p-6">
            <SkeletonLine className="h-5 w-36" />
            <div className="mt-5 divide-y divide-gray-100">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-2">
                      <SkeletonLine className="h-4 w-32" />
                      <SkeletonLine className="h-3 w-24" />
                    </div>
                    <SkeletonLine className="h-4 w-20" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-3xl bg-white p-6">
                <SkeletonLine className="h-4 w-32" />
                <SkeletonLine className="mt-3 h-3 w-48 max-w-full" />
                <SkeletonLine className="mt-2 h-3 w-36" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
