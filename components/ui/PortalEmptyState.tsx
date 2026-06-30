import Link from 'next/link'

interface PortalEmptyStateProps {
  title: string
  body: string
  actionHref?: string
  actionLabel?: string
}

export function PortalEmptyState({
  title,
  body,
  actionHref,
  actionLabel,
}: PortalEmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--accent-mint))] text-[rgb(var(--accent-mint-ink))]">
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </div>
      <h2 className="mt-4 text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-600">{body}</p>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-5 inline-flex items-center justify-center rounded-full bg-[rgb(var(--accent-mint))] px-6 py-2.5 text-sm font-medium text-[rgb(var(--accent-mint-ink))] transition-opacity duration-150 hover:opacity-90"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
