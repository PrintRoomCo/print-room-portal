'use client'

import Link from 'next/link'
import Image from 'next/image'
import { cartLineDisplayImageUrl, isGenericCustomDecorationName } from '@/lib/cart/types'
import { formatCurrency } from '@/lib/utils'

const LABEL_CAP =
  'text-[11px] font-medium tracking-[0.12em] text-gray-500'

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
  catalogueFrontImageUrl?: string | null
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
  orderId: string
  orderRef: string
  status: string | null
  // 2026-05-21 — `awaitingApproval` + `mondaySynced` are vestigial after the
  // auto-approve flow shipped. They still drive the right-rail "Production
  // sync is still finishing" hint at the bottom of this view; once that hint
  // is rewritten, both props can be removed on the same branch.
  awaitingApproval: boolean
  mondaySynced: boolean
  isInventoryOrder: boolean
  /** Feature #7 — stock-on-hand orders aren't tracked; hide the tracker CTA. */
  isStockOnHandOrder?: boolean
  customerEmail: string
  shippingAddress: ConfirmationAddress | null
  fulfilmentLabel: string
  requiredBy: string | null
  lines: ConfirmationLine[]
  /** Ex-GST goods actually INVOICED — prepaid draws count 0, plus pickingFee. */
  subtotalExGst: number
  decorationCost: number
  /** NZ picking fee charged on this order, ex-GST. 0 when none applies. */
  pickingFee: number
  /** Goods drawn from pre-paid stock and NOT invoiced. 0 for a normal order. */
  prepaidGoodsValue: number
  gst: number
  totalIncGst: number
  gstRate: number
  /** Immutable quote currency. Optional only for historical pre-SP3 quotes. */
  currency?: string
  /** Current display label for the immutable bill-country identity. */
  taxLabel?: string
  countryName?: string | null
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
  const {
    orderId,
    orderRef,
    status,
    awaitingApproval,
    mondaySynced,
    isInventoryOrder,
    shippingAddress,
    fulfilmentLabel,
    requiredBy,
    lines,
    subtotalExGst,
    pickingFee,
    prepaidGoodsValue,
    gst,
    totalIncGst,
    gstRate,
    currency = 'NZD',
    taxLabel,
    countryName,
  } = props
  const format = (amount: number) => formatCurrency(amount, currency)

  const addressLines = formatAddress(shippingAddress)
  const eta = formatRequiredBy(requiredBy)

  // 2026-05-21 — Checkout → Monday → Auto-proof pipeline: replaces the
  // legacy "Awaiting account manager approval" gate. After staff finish their
  // proof edits they push it to the customer, flipping status to
  // 'awaiting-customer-approval' — at which point the next hero line invites
  // the buyer back into the order to review the proof.
  const proofReady = status === 'awaiting-customer-approval'

  return (
    <>
      {/* Hero */}
      <header className="mb-10 md:mb-14">
        <p className={LABEL_CAP}>Order #{orderRef}</p>
        <h1 className="mt-4 font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
          Order received
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          We&rsquo;re preparing your proof.
        </p>
        {proofReady && (
          <div className="mt-5">
            <Link
              href={`/orders/${orderId}/proof`}
              className="inline-flex items-center justify-center rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
            >
              Your proof is ready — open the order to review
            </Link>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr,420px] lg:gap-12">
        {/* Left column */}
        <div className="space-y-6">
          {/* Order summary */}
          <section className="rounded-[32px] bg-white p-6 md:p-8">
            <h2 className={`mb-6 ${LABEL_CAP}`}>Order summary</h2>
            <div className="space-y-6">
              {lines.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No items recorded for this order.{' '}
                  <a
                    className="underline underline-offset-2 hover:text-gray-700"
                    href={SUPPORT_MAILTO}
                  >
                    Email us
                  </a>{' '}
                  so we can sort it.
                </p>
              ) : (
                lines.map((line) => {
                  const lineTotal = line.unitPrice * line.quantity
                  const imageUrl = cartLineDisplayImageUrl(line, {
                    catalogueFrontImageUrl: line.catalogueFrontImageUrl ?? null,
                  })
                  const visibleDecorations = line.decorations.filter(
                    (d) => !isGenericCustomDecorationName(d.name),
                  )
                  return (
                    <article
                      key={line.id}
                      className="flex items-start gap-x-6 gap-y-4 md:gap-5"
                    >
                      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-gray-50">
                        {imageUrl ? (
                          <Image
                            src={imageUrl}
                            alt={line.productName}
                            fill
                            sizes="96px"
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
                        {visibleDecorations.length > 0 && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            {visibleDecorations.map((d, i) => {
                              const icon = d.snapshotUrl ?? d.artworkUrl
                              return (
                                <span
                                  key={d.linkId ?? `${line.id}-deco-${i}`}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1 text-[11px] text-gray-700"
                                  title={d.name}
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
                                </span>
                              )
                            })}
                          </div>
                        )}
                        <p className="mt-3 text-xs text-gray-500">
                          <span className="tabular-nums text-gray-600">
                            {format(line.unitPrice)}
                          </span>
                          <span className="px-1.5 text-gray-300">×</span>
                          <span className="tabular-nums text-gray-600">
                            {line.quantity}
                          </span>
                        </p>
                      </div>
                      <p className="shrink-0 font-dm-sans text-base font-medium tabular-nums text-gray-900">
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
                  {isInventoryOrder ? 'Stock destination' : 'Shipping to'}
                </p>
                {isInventoryOrder ? (
                  <div className="space-y-0.5 text-gray-900">
                    <p>Print Room warehouse</p>
                    <p className="text-xs text-gray-500">
                      Stock lands on your inventory shelf at Print Room.
                    </p>
                  </div>
                ) : addressLines.length > 0 ? (
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
            <h2 className={LABEL_CAP}>Order total</h2>
            {countryName && (
              <p className="mb-5 mt-1 text-xs text-black/55">
                {countryName} · {currency}
              </p>
            )}
            {!countryName && <div className="mb-5" />}
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">
                  {prepaidGoodsValue > 0 ? 'Goods (pre-paid)' : 'Subtotal (ex-GST)'}
                </span>
                <span className="tabular-nums text-gray-900">
                  {format(subtotalExGst - pickingFee)}
                </span>
              </div>
              {/*
                Load-bearing: once goods read $0 this is the only place the
                picking-fee band basis appears, so the customer can tell why the
                fee is $15 rather than $35.
              */}
              {prepaidGoodsValue > 0 && (
                <div className="flex justify-between pl-3">
                  <span className="text-xs text-gray-500">Drawn from pre-paid stock</span>
                  <span className="text-xs tabular-nums text-gray-500">
                    {format(prepaidGoodsValue)}
                  </span>
                </div>
              )}
              {/*
                props.decorationCost remains available for diagnostics, but the
                customer-facing order total treats decoration as baked into the
                subtotal/unit prices.
              */}
              <div className="flex justify-between">
                <span className="text-gray-600">Shipping</span>
                <span className="text-gray-900">Included</span>
              </div>
              {pickingFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Picking fee</span>
                  <span className="tabular-nums text-gray-900">{format(pickingFee)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">
                  {taxLabel ?? `GST (${Math.round(gstRate * 100)}%)`}
                </span>
                <span className="tabular-nums text-gray-900">{format(gst)}</span>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="font-dm-sans text-base font-medium text-gray-900">
                  Total
                </span>
                <span className="font-dm-sans text-xl font-medium tabular-nums text-gray-900">
                  {format(totalIncGst)}
                </span>
              </div>
            </div>

            <div className="mt-7 space-y-3">
              {!props.isStockOnHandOrder && (
                <Link
                  href="/current-orders"
                  className="flex w-full items-center justify-center rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                >
                  Track this order
                </Link>
              )}
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
