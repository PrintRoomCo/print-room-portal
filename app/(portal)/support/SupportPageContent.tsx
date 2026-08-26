'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  CUSTOMER_SUPPORT_GUIDES,
  type CustomerSupportDestination,
} from './resources'

export interface CustomerSupportAccess {
  isCompanyUser: boolean
  isOrgAdmin: boolean
}

function destinationFor(
  destination: CustomerSupportDestination | undefined,
  access: CustomerSupportAccess,
) {
  if (!destination) return undefined
  const hasRequiredCapability =
    destination.requires === 'companyUser' ? access.isCompanyUser :
      destination.requires === 'orgAdmin' ? access.isOrgAdmin : true
  if (hasRequiredCapability) {
    return destination
  }
  return destination.fallback
}

export function CustomerSupportPageContent({ access }: { access: CustomerSupportAccess }) {
  const [expandedGuides, setExpandedGuides] = useState<Set<string>>(() => new Set())

  function toggleGuide(id: string) {
    setExpandedGuides((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 md:text-4xl">Support</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600 md:text-base">
            Find the essentials for ordering through the portal, or get in touch with our support team.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:flex md:items-center md:justify-between md:gap-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Need a hand?</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              Send the portal support team the details of what you were trying to do.
            </p>
          </div>
          <a
            href="mailto:support@printroom.co?subject=Customer%20portal%20support"
            className="btn-accent mt-4 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-brand-blue))] focus-visible:ring-offset-2 md:mt-0"
          >
            Contact portal support
          </a>
        </section>

        <section className="mt-10 max-w-3xl" aria-labelledby="support-guides-title">
          <h2 id="support-guides-title" className="text-xl font-semibold text-gray-900">
            Portal guides
          </h2>
          <div className="mt-4 space-y-3">
            {CUSTOMER_SUPPORT_GUIDES.map((guide) => {
              const expanded = expandedGuides.has(guide.id)
              const destination = destinationFor(guide.destination, access)
              const contentId = `${guide.id}-content`

              return (
                <article key={guide.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <button
                    type="button"
                    aria-label={guide.title}
                    aria-expanded={expanded}
                    aria-controls={contentId}
                    onClick={() => toggleGuide(guide.id)}
                    className="flex w-full items-center justify-between gap-4 rounded-2xl px-5 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--color-brand-blue))]"
                  >
                    <span>
                      <span className="block text-base font-semibold text-gray-900">{guide.title}</span>
                      <span className="mt-1 block text-sm leading-6 text-gray-600">{guide.intro}</span>
                    </span>
                    <span aria-hidden="true" className="text-lg text-[rgb(var(--color-brand-blue))]">
                      {expanded ? '−' : '+'}
                    </span>
                  </button>

                  {expanded && (
                    <div id={contentId} className="border-t border-gray-100 px-5 py-5">
                      <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-700">
                        {guide.steps.map((step) => <li key={step}>{step}</li>)}
                      </ol>
                      {(destination || guide.videoUrl) && (
                        <div className="mt-5 flex flex-wrap gap-3">
                          {destination && (
                            <Link href={destination.href} className="btn-primary px-4 py-2 text-xs">
                              {destination.label}
                            </Link>
                          )}
                          {guide.videoUrl && (
                            <a
                              href={guide.videoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn-secondary px-4 py-2 text-xs"
                            >
                              Watch video
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
