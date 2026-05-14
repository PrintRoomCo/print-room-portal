'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

export interface Crumb {
  label: string
  href?: string
}

interface Props {
  crumbs: Crumb[]
}

export function CatalogueTopBar({ crumbs }: Props) {
  const router = useRouter()

  return (
    <div className="mb-4 flex items-center gap-3 md:mb-6">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 overflow-hidden text-sm text-gray-500">
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1
            return (
              <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {crumb.href && !isLast ? (
                  <Link
                    href={crumb.href}
                    className="truncate transition-colors hover:text-gray-900"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className={`truncate ${isLast ? 'font-medium text-gray-900' : ''}`}
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
                {!isLast && <span className="text-gray-300">/</span>}
              </li>
            )
          })}
        </ol>
      </nav>
    </div>
  )
}
