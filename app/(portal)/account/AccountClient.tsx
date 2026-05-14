'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'
import { useCurrency } from '@/contexts/CurrencyContext'
import { updateProfile, changePasswordAction, createLocationAction, type ActionResult } from './actions'
import { formatPrice } from '@/lib/format/price'
import { formatCurrency } from '@/lib/currency/format'
import type { SupportedCurrency } from '@/lib/currency/types'

// New Zealand region codes (ISO 3166-2:NZ)
const NZ_REGIONS = [
  { code: 'AUK', name: 'Auckland' },
  { code: 'BOP', name: 'Bay of Plenty' },
  { code: 'CAN', name: 'Canterbury' },
  { code: 'GIS', name: 'Gisborne' },
  { code: 'HKB', name: "Hawke's Bay" },
  { code: 'MBH', name: 'Marlborough' },
  { code: 'MWT', name: 'Manawatu-Wanganui' },
  { code: 'NSN', name: 'Nelson' },
  { code: 'NTL', name: 'Northland' },
  { code: 'OTA', name: 'Otago' },
  { code: 'STL', name: 'Southland' },
  { code: 'TAS', name: 'Tasman' },
  { code: 'TKI', name: 'Taranaki' },
  { code: 'WGN', name: 'Wellington' },
  { code: 'WKO', name: 'Waikato' },
  { code: 'WTC', name: 'West Coast' },
]

const CURRENCY_OPTIONS: SupportedCurrency[] = ['NZD', 'AUD', 'USD', 'GBP', 'EUR']

const CURRENCY_LABEL: Record<SupportedCurrency, string> = {
  NZD: 'NZ$',
  AUD: 'A$',
  USD: 'US$',
  GBP: '£',
  EUR: '€',
}

interface Store {
  id: string
  name: string
  address: string | null
  location: string | null
  city: string | null
  state: string | null
  country: string | null
  postal_code: string | null
  phone: string | null
}

interface Quote {
  id: string
  quote_number: string | null
  status: string
  total_amount: number
  currency: string
  line_items: any[] | null
  created_at: string
}

interface Props {
  ratesFetchedAt: string | null
}

export function AccountClient({ ratesFetchedAt }: Props) {
  const { access, loading: companyLoading } = useCompany()

  const [stores, setStores] = useState<Store[]>([])
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([])
  const [dataLoading, setDataLoading] = useState(true)

  const [showAddStore, setShowAddStore] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [showPasswordChange, setShowPasswordChange] = useState(false)

  const [profileResult, setProfileResult] = useState<ActionResult | null>(null)
  const [profileSubmitting, setProfileSubmitting] = useState(false)

  const [passwordResult, setPasswordResult] = useState<ActionResult | null>(null)
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)

  const [locationResult, setLocationResult] = useState<ActionResult | null>(null)
  const [locationSubmitting, setLocationSubmitting] = useState(false)

  const fetchAccountData = useCallback(() => {
    fetch('/api/account-data')
      .then((res) => (res.ok ? res.json() : { stores: [], recentQuotes: [] }))
      .then((data) => {
        setStores(data.stores || [])
        setRecentQuotes(data.recentQuotes || [])
        setDataLoading(false)
      })
      .catch(() => setDataLoading(false))
  }, [])

  useEffect(() => {
    if (!companyLoading && access) {
      fetchAccountData()
    } else if (!companyLoading) {
      setDataLoading(false)
    }
  }, [companyLoading, access, fetchAccountData])

  useEffect(() => {
    if (profileResult?.success && editingProfile) {
      const timer = setTimeout(() => {
        setEditingProfile(false)
        window.location.reload()
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [profileResult, editingProfile])

  useEffect(() => {
    if (passwordResult?.success && showPasswordChange) {
      const timer = setTimeout(() => {
        setShowPasswordChange(false)
        setPasswordResult(null)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [passwordResult, showPasswordChange])

  useEffect(() => {
    if (locationResult?.success && showAddStore) {
      const timer = setTimeout(() => {
        setShowAddStore(false)
        setLocationResult(null)
        fetchAccountData()
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [locationResult, showAddStore, fetchAccountData])

  async function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setProfileSubmitting(true)
    setProfileResult(null)
    const formData = new FormData(e.currentTarget)
    const result = await updateProfile(formData)
    setProfileResult(result)
    setProfileSubmitting(false)
  }

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPasswordSubmitting(true)
    setPasswordResult(null)
    const formData = new FormData(e.currentTarget)
    const result = await changePasswordAction(formData)
    setPasswordResult(result)
    setPasswordSubmitting(false)
  }

  async function handleLocationSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLocationSubmitting(true)
    setLocationResult(null)
    const formData = new FormData(e.currentTarget)
    const result = await createLocationAction(formData)
    setLocationResult(result)
    setLocationSubmitting(false)
  }

  if (companyLoading || dataLoading) {
    return (
      <div className="animate-pulse space-y-16">
        <div className="h-[420px] rounded-[32px] bg-white" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="h-56 rounded-[24px] bg-white" />
          <div className="h-56 rounded-[24px] bg-white" />
          <div className="h-56 rounded-[24px] bg-white" />
        </div>
      </div>
    )
  }

  if (!access) return null

  const primaryStore = stores[0] || null
  const roleLabel = capitalizeRole(access.role)
  const chipLabel = access.companyName
    ? `${roleLabel} · ${access.companyName}`
    : roleLabel

  return (
    <div className="space-y-16">
      {/* ── Hero card: H1 + role chip + Profile/Address ─────────────── */}
      <section className="relative rounded-[32px] bg-white p-8 md:p-12">
        {!editingProfile && (
          <button
            type="button"
            onClick={() => setEditingProfile(true)}
            className="absolute right-8 top-8 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-600 transition-colors hover:text-gray-900 md:right-12 md:top-12"
          >
            Edit
          </button>
        )}

        <h1 className="font-dm-sans font-medium text-gray-900 text-[clamp(40px,5vw,72px)] leading-[1.05] tracking-[-0.02em]">
          My Account
        </h1>
        <div className="mt-4">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {chipLabel}
          </span>
        </div>

        {profileResult?.success && (
          <div className="mt-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {profileResult.message}
          </div>
        )}
        {profileResult?.errors && (
          <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {profileResult.errors.map((error, i) => (
              <p key={i}>{error}</p>
            ))}
          </div>
        )}

        {/* Two-column profile + default address inside the hero */}
        <div className="mt-10 grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
          <div>
            <SmallCapLabel>Profile</SmallCapLabel>
            <div className="mt-4">
              {editingProfile ? (
                <form onSubmit={handleProfileSubmit} className="space-y-4">
                  <div>
                    <SmallCapLabel as="label" htmlFor="firstName">First name</SmallCapLabel>
                    <input
                      type="text"
                      id="firstName"
                      name="firstName"
                      defaultValue={access.firstName}
                      required
                      aria-label="First name"
                      className="mt-2 w-full rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900"
                    />
                  </div>
                  <div>
                    <SmallCapLabel as="label" htmlFor="lastName">Last name</SmallCapLabel>
                    <input
                      type="text"
                      id="lastName"
                      name="lastName"
                      defaultValue={access.lastName}
                      required
                      aria-label="Last name"
                      className="mt-2 w-full rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900"
                    />
                  </div>
                  <div>
                    <SmallCapLabel>Email</SmallCapLabel>
                    <p className="mt-2 text-base text-gray-900">{access.email}</p>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setEditingProfile(false); setProfileResult(null) }}
                      className="rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={profileSubmitting}
                      className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {profileSubmitting ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="space-y-4">
                  <Field label="Name" value={`${access.firstName} ${access.lastName}`} />
                  <Field label="Email" value={access.email} />
                  {access.companyName && <Field label="Company" value={access.companyName} />}
                  <Field label="Account type" value={roleLabel} />
                </dl>
              )}
            </div>
          </div>

          <div>
            <SmallCapLabel>Default address</SmallCapLabel>
            <div className="mt-4">
              {primaryStore && (primaryStore.address || primaryStore.city) ? (
                <div className="space-y-1 text-base text-gray-900">
                  <p className="font-medium">{primaryStore.name}</p>
                  {primaryStore.address && <p className="text-gray-700">{primaryStore.address}</p>}
                  {primaryStore.location && <p className="text-gray-700">{primaryStore.location}</p>}
                  <p className="text-gray-700">
                    {[primaryStore.city, primaryStore.state, primaryStore.country].filter(Boolean).join(', ')}
                  </p>
                  {primaryStore.postal_code && <p className="text-gray-700">{primaryStore.postal_code}</p>}
                  {primaryStore.phone && (
                    <p className="pt-2 text-sm text-gray-500">Tel: {primaryStore.phone}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No default address set</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3-up smaller cards ──────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <DisplayPreferencesCard ratesFetchedAt={ratesFetchedAt} />
        <SecurityCard
          open={showPasswordChange}
          submitting={passwordSubmitting}
          result={passwordResult}
          onOpen={() => setShowPasswordChange(true)}
          onCancel={() => { setShowPasswordChange(false); setPasswordResult(null) }}
          onSubmit={handlePasswordSubmit}
        />
        <RecentQuotesCard quotes={recentQuotes} />
      </section>

      {/* ── Locations horizontal scroll strip ───────────────────────── */}
      {access.isCompanyUser && (
        <section>
          <div className="flex items-end justify-between px-2">
            <SmallCapLabel>Locations</SmallCapLabel>
          </div>
          <div className="mt-4 -mx-6 overflow-x-auto px-6 pb-2">
            <div className="flex gap-4 min-w-min">
              {stores.map((store) => (
                <LocationCard key={store.id} store={store} />
              ))}
              {access.isOrgAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAddStore(true)}
                  className="flex h-full min-h-[220px] w-72 shrink-0 flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-gray-300 bg-transparent text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700"
                >
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                    <PlusIcon />
                  </div>
                  <span className="text-sm font-medium">Add location</span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Add Location modal (unchanged behaviour) ────────────────── */}
      {showAddStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[24px] bg-white p-8 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Add location</h2>
              <button
                type="button"
                onClick={() => { setShowAddStore(false); setLocationResult(null) }}
                aria-label="Close"
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <CloseIcon />
              </button>
            </div>

            {locationResult?.success && (
              <div className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {locationResult.message}
              </div>
            )}
            {locationResult?.errors && (
              <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {locationResult.errors.map((error, i) => (
                  <p key={i}>{error}</p>
                ))}
              </div>
            )}

            <form onSubmit={handleLocationSubmit} className="space-y-4">
              <Input id="storeName" name="storeName" label="Location name" required placeholder="e.g., Auckland Downtown" />
              <Input id="phone" name="phone" type="tel" label="Phone" placeholder="e.g., 09 123 4567 or 021 123 4567" hint="NZ numbers will be formatted automatically" />

              <div className="pt-2">
                <SmallCapLabel>Shipping address</SmallCapLabel>
                <div className="mt-3 space-y-3">
                  <Input id="address1" name="address1" label="Street" placeholder="123 Main Street" />
                  <Input id="address2" name="address2" label="Unit / suite (optional)" placeholder="Suite 100" />
                  <div className="grid grid-cols-2 gap-3">
                    <Input id="city" name="city" label="City" placeholder="Auckland" />
                    <div>
                      <SmallCapLabel as="label" htmlFor="regionCode">Region</SmallCapLabel>
                      <select
                        id="regionCode"
                        name="regionCode"
                        aria-label="Region"
                        className="mt-2 w-full rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900"
                      >
                        <option value="">Select region…</option>
                        {NZ_REGIONS.map((region) => (
                          <option key={region.code} value={region.code}>
                            {region.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <Input id="zip" name="zip" label="Postal code" placeholder="1010" />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowAddStore(false); setLocationResult(null) }}
                  className="flex-1 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={locationSubmitting}
                  className="flex-1 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  {locationSubmitting ? 'Creating…' : 'Create location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Card sub-components ─────────────────────────────────────────────

function DisplayPreferencesCard({ ratesFetchedAt }: { ratesFetchedAt: string | null }) {
  const { currency, setCurrency, loading } = useCurrency()
  const fetchedLabel = ratesFetchedAt
    ? new Date(ratesFetchedAt).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })
    : 'unknown'

  return (
    <article className="rounded-[24px] bg-white p-8">
      <SmallCapLabel>Display preferences</SmallCapLabel>
      <h3 className="mt-3 text-lg font-medium text-gray-900">Currency</h3>
      <div
        role="radiogroup"
        aria-label="Display currency"
        className="mt-4 inline-flex rounded-full bg-gray-100 p-1"
      >
        {CURRENCY_OPTIONS.map((code) => {
          const active = code === currency
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active ? 'true' : 'false'}
              disabled={loading}
              onClick={() => setCurrency(code)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {CURRENCY_LABEL[code]}
            </button>
          )
        })}
      </div>
      <p className="mt-4 text-xs text-gray-500">
        Stored in NZD, converted for display. Rates updated {fetchedLabel}.
      </p>
    </article>
  )
}

function SecurityCard({
  open,
  submitting,
  result,
  onOpen,
  onCancel,
  onSubmit,
}: {
  open: boolean
  submitting: boolean
  result: ActionResult | null
  onOpen: () => void
  onCancel: () => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <article className="rounded-[24px] bg-white p-8">
      <div className="flex items-start justify-between">
        <SmallCapLabel>Security</SmallCapLabel>
        {!open && (
          <button
            type="button"
            onClick={onOpen}
            className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-600 transition-colors hover:text-gray-900"
          >
            Change password
          </button>
        )}
      </div>

      {result?.success && (
        <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {result.message}
        </div>
      )}
      {result?.errors && (
        <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {result.errors.map((error, i) => (
            <p key={i}>{error}</p>
          ))}
        </div>
      )}

      {open ? (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <Input id="currentPassword" name="currentPassword" type="password" label="Current password" required />
          <Input id="newPassword" name="newPassword" type="password" label="New password" required hint="Min 8 chars, with uppercase, lowercase, and a number" />
          <Input id="confirmPassword" name="confirmPassword" type="password" label="Confirm new password" required />
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm text-gray-500">
          Use a strong, unique password to protect your account.
        </p>
      )}
    </article>
  )
}

function RecentQuotesCard({ quotes }: { quotes: Quote[] }) {
  return (
    <article className="rounded-[24px] bg-white p-8">
      <div className="flex items-start justify-between">
        <SmallCapLabel>Recent quotes</SmallCapLabel>
        <Link
          href="/my-collections"
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-600 transition-colors hover:text-gray-900"
        >
          View all
        </Link>
      </div>

      {quotes.length === 0 ? (
        <div className="mt-6 flex flex-col items-center py-6 text-center">
          <BagIcon />
          <p className="mt-3 text-sm font-medium text-gray-900">No quotes yet</p>
          <p className="mt-1 text-xs text-gray-500">Your quote history will appear here.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {quotes.slice(0, 3).map((quote) => {
            const lineItems = Array.isArray(quote.line_items) ? quote.line_items : []
            const totalAmount = Number(quote.total_amount)
            const totalLabel =
              Number.isFinite(totalAmount) && totalAmount > 0
                ? formatCurrency(totalAmount, (quote.currency || 'NZD') as SupportedCurrency)
                : formatPrice(quote.total_amount)
            return (
              <li key={quote.id} className="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    Quote {quote.quote_number || '—'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(quote.created_at).toLocaleDateString()} · {lineItems.length} item{lineItems.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium text-gray-900">{totalLabel}</p>
              </li>
            )
          })}
        </ul>
      )}
    </article>
  )
}

function LocationCard({ store }: { store: Store }) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-[24px] bg-white p-6">
      <h3 className="font-medium text-gray-900">{store.name}</h3>
      <div className="mt-2 flex-1 space-y-0.5 text-sm text-gray-600">
        {store.address || store.city ? (
          <>
            {store.address && <p>{store.address}</p>}
            {store.location && <p>{store.location}</p>}
            <p>{[store.city, store.state, store.country].filter(Boolean).join(', ')}</p>
            {store.postal_code && <p>{store.postal_code}</p>}
          </>
        ) : (
          <p className="italic text-gray-400">No address on file</p>
        )}
        {store.phone && <p className="pt-1">Tel: {store.phone}</p>}
      </div>
      <Link
        href={`/tracking?location=${encodeURIComponent(store.id)}`}
        className="mt-4 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-600 transition-colors hover:text-gray-900"
      >
        View orders
      </Link>
    </div>
  )
}

// ── Generic helpers ─────────────────────────────────────────────────

function SmallCapLabel({
  children,
  as = 'span',
  htmlFor,
}: {
  children: React.ReactNode
  as?: 'span' | 'label'
  htmlFor?: string
}) {
  const className = 'text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500'
  if (as === 'label') {
    return (
      <label htmlFor={htmlFor} className={className}>
        {children}
      </label>
    )
  }
  return <span className={className}>{children}</span>
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <SmallCapLabel>{label}</SmallCapLabel>
      <p className="mt-1 text-base text-gray-900">{value}</p>
    </div>
  )
}

function Input({
  id,
  name,
  label,
  type = 'text',
  required = false,
  placeholder,
  hint,
}: {
  id: string
  name: string
  label: string
  type?: string
  required?: boolean
  placeholder?: string
  hint?: string
}) {
  return (
    <div>
      <SmallCapLabel as="label" htmlFor={id}>{label}{required ? ' *' : ''}</SmallCapLabel>
      <input
        type={type}
        id={id}
        name={name}
        required={required}
        placeholder={placeholder}
        className="mt-2 w-full rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900"
      />
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function capitalizeRole(role: string): string {
  if (!role) return ''
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function BagIcon() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <line x1="3" x2="21" y1="6" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
