'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCurrency } from '@/contexts/CurrencyContext'

const LABEL_CAP =
  'text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500'

const SUPPORT_MAILTO = 'mailto:hello@theprint-room.co.nz'

export interface ConfirmationDecoration {
  linkId?: string | null
  name: string
  unitPrice: number
  snapshotUrl?: string | null
  artworkUrl?: string | null
  positionLabel?: string | null
}

export interface ConfirmationLine {
  id: string
  productName: string
  variantLabel: string | null
  quantity: number
  unitPrice: number
  imageUrl: string | null
  decorations: ConfirmationDecoration[]
}

export interface ConfirmationAddress {
  name?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
}

interface ConfirmationViewProps {
  orderRef: string
  status: string | null
  awaitingApproval: boolean
  mondaySynced: boolean
  customerEmail: string
  shippingAddress: ConfirmationAddress | null
  fulfilmentLabel: string
  requiredBy: string | null
  lines: ConfirmationLine[]
  subtotalExGst: number
  decorationCost: number
  gst: number
  totalIncGst: number
  gstRate: number
}

function formatRequiredBy(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatAddress(addr: ConfirmationAddress | null): string[] {
  if (!addr) return []
  const lines: string[] = []
  if (addr.name) lines.push(addr.name)
  if (addr.address) lines.push(addr.address)
  const cityLine = [addr.city, addr.state, addr.postal_code].filter(Boolean).join(' ')
  if (cityLine) lines.push(cityLine)
  if (addr.country) lines.push(addr.country)
  return lines
}

export function ConfirmationView(props: ConfirmationViewProps) {
  const { format } = useCurrency()
  const {
    orderRef,
    awaitingApproval,
    mondaySynced,
    customerEmail,
    shippingAddress,
    fulfilmentLabel,
    requiredBy,
    lines,
    subtotalExGst,
    decorationCost,
    gst,
    totalIncGst,
    gstRate,
  } = props

  const addressLines = formatAddress(shippingAddress)
  const eta = formatRequiredBy(requiredBy)

  return (
    <>
      {/* Hero */}
      <header className="mb-10 md:mb-14">
        <p className={LABEL_CAP}>Order #{orderRef}</p>
        <h1 className="mt-4 font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
          Thanks, your order is in.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-gray-600">
          We&rsquo;ve emailed a receipt to {customerEmail} and the Print Room
          team has been notified. We&rsquo;ll be in touch as your order moves
          through proof, production and dispatch.
        </p>
        {awaitingApproval && (
          <p className="mt-5 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            Awaiting account manager approval
          </p>
        )}
      </header>

      {/* Body */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr,420px] lg:gap-12">
        {/* Left column */}
        <div className="space-y-6">
          {/* Order summary */}
          <section className="rounded-[32px] bg-white p-6 md:p-8">
            <h2 className={`mb-6 ${LABEL_CAP}`}>Order summary</h2>
            <div className="space-y-4">
              {lines.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Items will appear here once they finish syncing.
                </p>
              ) : (
                lines.map((line) => {
                  const decoPerUnit = line.decorations.reduce(
                    (s, d) => s + d.unitPrice,
                    0,
                  )
                  const lineTotal = (line.unitPrice + decoPerUnit) * line.quantity
                  return (
                    <article
                      key={line.id}
                      className="flex items-start gap-4 border-b border-gray-100 pb-4 last:border-0 last:pb-0 md:gap-5"
                    >
                      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-gray-50">
                        {line.imageUrl ? (
                          <Image
                            src={line.imageUrl}
                            alt={line.productName}
                            fill
                            sizes="80px"
                            className="object-contain p-2"
                            unoptimized
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-dm-sans text-base font-medium text-gray-900">
                          {line.productName}
                        </p>
                        {line.variantLabel && (
                          <p className={`mt-1 ${LABEL_CAP}`}>{line.variantLabel}</p>
                        )}
                        {line.decorations.length > 0 && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            {line.decorations.map((d, i) => {
                              const icon = d.snapshotUrl ?? d.artworkUrl
                              return (
                                <span
                                  key={d.linkId ?? `${line.id}-deco-${i}`}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1 text-[11px] text-gray-700"
                                  title={`${d.name} · +${format(d.unitPrice)} / unit`}
                                >
                                  {icon ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                      src={icon}
                                      alt=""
                                      className="h-4 w-4 rounded-sm bg-white object-contain"
                                    />
                                  ) : null}
                                  <span className="font-medium">{d.name}</span>
                                  <span className="tabular-nums text-gray-500">
                                    +{format(d.unitPrice)}
                                  </span>
                                </span>
                              )
                            })}
                          </div>
                        )}
                        <p className="mt-3 text-sm text-gray-500">
                          <span className="tabular-nums text-gray-700">
                            {line.quantity}
                          </span>{' '}
                          ×{' '}
                          <span className="tabular-nums text-gray-700">
                            {format(line.unitPrice + decoPerUnit)}
                          </span>
                        </p>
                      </div>
                      <p className="font-dm-sans text-base font-medium tabular-nums text-gray-900">
                        {format(lineTotal)}
                      </p>
                    </article>
                  )
                })
              )}
            </div>
          </section>

          {/* Delivery */}
          <section className="rounded-[24px] bg-white p-6">
            <h2 className={`mb-4 ${LABEL_CAP}`}>Delivery</h2>
            <div className="grid grid-cols-1 gap-5 text-sm md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">
                  Shipping to
                </p>
                {addressLines.length > 0 ? (
                  <div className="space-y-0.5 text-gray-900">
                    {addressLines.map((l) => (
                      <p key={l}>{l}</p>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">
                    Address will be confirmed by your account manager.
                  </p>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-500">
                    Fulfilment
                  </p>
                  <p className="text-gray-900">{fulfilmentLabel}</p>
                </div>
                {eta && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-gray-500">
                      Required by
                    </p>
                    <p className="text-gray-900">{eta}</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Next steps */}
          <section className="rounded-[24px] bg-white p-6">
            <h2 className={`mb-5 ${LABEL_CAP}`}>What happens next</h2>
            <ol className="space-y-5">
              <li>
                <p className={LABEL_CAP}>Proof</p>
                <p className="mt-1.5 text-sm text-gray-700">
                  Our account managers prepare a digital proof for any
                  decorated items. We&rsquo;ll send it your way for sign-off
                  before anything hits production.
                </p>
              </li>
              <li>
                <p className={LABEL_CAP}>Production</p>
                <p className="mt-1.5 text-sm text-gray-700">
                  Once approved, your order moves into the production queue.
                  You can track its progress at any time from the order tracker.
                </p>
              </li>
              <li>
                <p className={LABEL_CAP}>Dispatch</p>
                <p className="mt-1.5 text-sm text-gray-700">
                  We&rsquo;ll let you know the moment your order ships and
                  share tracking details so you can hand them on internally.
                </p>
              </li>
            </ol>
          </section>
        </div>

        {/* Right column — sticky totals */}
        <aside className="lg:sticky lg:top-[100px] lg:h-fit">
          <div className="rounded-[32px] bg-white p-6 md:p-8">
            <h2 className={`mb-5 ${LABEL_CAP}`}>Order total</h2>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal (ex-GST)</span>
                <span className="tabular-nums text-gray-900">
                  {format(subtotalExGst)}
                </span>
              </div>
              {decorationCost > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span className="pl-3">Includes decoration</span>
                  <span className="tabular-nums">{format(decorationCost)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-100 pt-2.5">
                <span className="text-gray-600">Shipping</span>
                <span className="tabular-nums text-gray-500">
                  Calculated separately
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">
                  GST ({Math.round(gstRate * 100)}%)
                </span>
                <span className="tabular-nums text-gray-900">{format(gst)}</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-gray-100 pt-3">
                <span className="font-dm-sans text-base font-medium text-gray-900">
                  Total
                </span>
                <span className="font-dm-sans text-xl font-medium tabular-nums text-gray-900">
                  {format(totalIncGst)}
                </span>
              </div>
            </div>

            <div className="mt-7 space-y-3">
              <Link
                href="/order-tracker"
                className="flex w-full items-center justify-center rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
              >
                Track this order
              </Link>
              <Link
                href="/catalogue"
                className="flex w-full items-center justify-center rounded-full bg-gray-50 px-6 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-2"
              >
                Continue shopping
              </Link>
            </div>

            <p className="mt-6 text-xs text-gray-500">
              Need to change something on this order?{' '}
              <a
                href={SUPPORT_MAILTO}
                className="rounded-full text-gray-700 underline-offset-2 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
              >
                Email us
              </a>{' '}
              and we&rsquo;ll pick it up.
            </p>

            {!mondaySynced && !awaitingApproval && (
              <p className="mt-4 text-xs text-gray-500">
                Production sync is still finishing. If it takes more than a few
                minutes our staff will reconcile it from their side &mdash;
                your order is safe.
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
