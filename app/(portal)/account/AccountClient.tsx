'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'
import { useCurrency } from '@/contexts/CurrencyContext'
import { CURRENCY_OPTIONS, type SupportedCurrency } from '@/lib/currency/types'
import {
  updateProfile,
  changePasswordAction,
  createLocationAction,
  type ActionResult,
} from './actions'
import { formatPrice } from '@/lib/format/price'
import { formatCurrency } from '@/lib/currency/format'

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
  line_items: unknown[] | null
  created_at: string
}

interface AccountClientProps {
  ratesFetchedAt: string | null
}

const LABEL_CAP =
  'text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500'
const GHOST_LINK =
  'text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 transition-colors duration-150 hover:text-gray-900'

export function AccountClient({ ratesFetchedAt }: AccountClientProps) {
  const { access, loading: companyLoading } = useCompany()
  const { currency, setCurrency } = useCurrency()

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
      <div className="space-y-16 animate-pulse">
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
  const roleLabel =
    access.role === 'org_admin' ? 'Org admin' : access.role === 'buyer' ? 'Buyer' : access.role
  const chipText = access.companyName
    ? `${roleLabel} · ${access.companyName}`
    : roleLabel
  const fetchedLabel = ratesFetchedAt
    ? new Date(ratesFetchedAt).toLocaleString('en-NZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'unknown'

  return (
    <div className="space-y-16">
      {/* ─── Hero card ─── */}
      <section className="relative rounded-[32px] bg-white p-8 md:p-12">
        {!editingProfile && (
          <button
            type="button"
            onClick={() => setEditingProfile(true)}
            className={`absolute right-8 top-8 md:right-12 md:top-12 ${GHOST_LINK}`}
          >
            Edit
          </button>
        )}

        <h1 className="font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
          My Account
        </h1>

        <span className="mt-4 inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
          {chipText}
        </span>

        <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
          {/* Profile */}
          <div>
            <h2 className={LABEL_CAP}>Profile</h2>

            {profileResult?.success && (
              <div className="mt-3 rounded-2xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                {profileResult.message}
              </div>
            )}
            {profileResult?.errors && (
              <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-2 text-sm text-rose-800">
                {profileResult.errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}

            {editingProfile ? (
              <form onSubmit={handleProfileSubmit} className="mt-5 space-y-4">
                <Field
                  label="First name"
                  name="firstName"
                  defaultValue={access.firstName}
                  required
                />
                <Field
                  label="Last name"
                  name="lastName"
                  defaultValue={access.lastName}
                  required
                />
                <FieldStatic label="Email" value={access.email} />
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProfile(false)
                      setProfileResult(null)
                    }}
                    className="rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={profileSubmitting}
                    className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {profileSubmitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                <FieldStatic
                  label="Name"
                  value={`${access.firstName} ${access.lastName}`}
                />
                <FieldStatic label="Email" value={access.email} />
                {access.companyName && (
                  <FieldStatic label="Company" value={access.companyName} />
                )}
                <FieldStatic label="Role" value={roleLabel} />
              </div>
            )}
          </div>

          {/* Default address */}
          <div>
            <h2 className={LABEL_CAP}>Default address</h2>
            {primaryStore && (primaryStore.address || primaryStore.city) ? (
              <div className="mt-5 space-y-1 text-sm text-gray-700">
                <p className="text-base font-medium text-gray-900">
                  {primaryStore.name}
                </p>
                {primaryStore.address && <p>{primaryStore.address}</p>}
                {primaryStore.location && <p>{primaryStore.location}</p>}
                <p>
                  {[primaryStore.city, primaryStore.state, primaryStore.country]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                {primaryStore.postal_code && <p>{primaryStore.postal_code}</p>}
                {primaryStore.phone && (
                  <p className="pt-2 text-xs text-gray-500">
                    Tel: {primaryStore.phone}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-5 text-sm text-gray-500">No default address set</p>
            )}
          </div>
        </div>
      </section>

      {/* ─── 3-up grid ─── */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Display preferences with segmented currency pill */}
        <article className="rounded-[24px] bg-white p-8">
          <h3 className={LABEL_CAP}>Display preferences</h3>
          <p className="mt-3 text-base font-medium text-gray-900">Currency</p>
          <div
            role="radiogroup"
            aria-label="Display currency"
            className="mt-4 inline-flex rounded-full bg-gray-100 p-1"
          >
            {CURRENCY_OPTIONS.map((opt) => {
              const active = currency === opt.code
              return (
                <button
                  key={opt.code}
                  type="button"
                  role="radio"
                  aria-checked={active ? ('true' as const) : ('false' as const)}
                  onClick={() => setCurrency(opt.code as SupportedCurrency)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                    active
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {opt.shortLabel}
                </button>
              )
            })}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Prices are stored in NZD and converted for display. Last rate update:{' '}
            {fetchedLabel}.
          </p>
        </article>

        {/* Security */}
        <article className="relative rounded-[24px] bg-white p-8">
          {!showPasswordChange && (
            <button
              type="button"
              onClick={() => setShowPasswordChange(true)}
              className={`absolute right-8 top-8 ${GHOST_LINK}`}
            >
              Change password
            </button>
          )}

          <h3 className={LABEL_CAP}>Security</h3>
          <p className="mt-3 text-base font-medium text-gray-900">Password</p>

          {passwordResult?.success && (
            <div className="mt-3 rounded-2xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
              {passwordResult.message}
            </div>
          )}
          {passwordResult?.errors && (
            <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-2 text-sm text-rose-800">
              {passwordResult.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}

          {showPasswordChange ? (
            <form onSubmit={handlePasswordSubmit} className="mt-5 space-y-4">
              <Field
                label="Current password"
                name="currentPassword"
                type="password"
                required
              />
              <Field
                label="New password"
                name="newPassword"
                type="password"
                required
                minLength={8}
                hint="Min 8 chars, with uppercase, lowercase, and a number"
              />
              <Field
                label="Confirm new password"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
              />
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordChange(false)
                    setPasswordResult(null)
                  }}
                  className="rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passwordSubmitting}
                  className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {passwordSubmitting ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          ) : (
            <p className="mt-4 text-xs text-gray-500">
              Use a strong, unique password to protect your account.
            </p>
          )}
        </article>

        {/* Recent quotes */}
        <article className="relative rounded-[24px] bg-white p-8">
          <Link href="/my-collections" className={`absolute right-8 top-8 ${GHOST_LINK}`}>
            View all
          </Link>

          <h3 className={LABEL_CAP}>Recent quotes</h3>

          {recentQuotes.length === 0 ? (
            <div className="mt-6 flex flex-col items-start">
              <BagIcon className="h-8 w-8 text-gray-300" />
              <p className="mt-3 text-base font-medium text-gray-900">
                No quotes yet
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Your quote history will appear here
              </p>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {recentQuotes.slice(0, 3).map((quote) => {
                const lineItems = Array.isArray(quote.line_items)
                  ? quote.line_items
                  : []
                const totalAmount = Number(quote.total_amount)
                const totalLabel =
                  Number.isFinite(totalAmount) && totalAmount > 0
                    ? formatCurrency(
                        totalAmount,
                        (quote.currency || 'NZD') as SupportedCurrency,
                      )
                    : formatPrice(quote.total_amount)
                return (
                  <li key={quote.id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        Quote {quote.quote_number || '—'}
                      </p>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-gray-500">
                        {new Date(quote.created_at).toLocaleDateString()} ·{' '}
                        {lineItems.length} item{lineItems.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="ml-3 shrink-0 text-sm font-medium text-gray-900">
                      {totalLabel}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </article>
      </section>

      {/* ─── Locations strip ─── */}
      {access.isCompanyUser && (
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className={LABEL_CAP}>Locations</h2>
            <span className="text-[11px] text-gray-400">
              {stores.length} {stores.length === 1 ? 'location' : 'locations'}
            </span>
          </div>
          <div className="mt-5 -mx-6 overflow-x-auto px-6 pb-2">
            <div className="flex gap-4">
              {stores.map((store) => (
                <article
                  key={store.id}
                  className="flex w-72 shrink-0 flex-col rounded-[24px] bg-white p-6"
                >
                  <h3 className="text-base font-medium text-gray-900">
                    {store.name}
                  </h3>
                  {store.address || store.city ? (
                    <div className="mt-2 space-y-0.5 text-sm text-gray-600">
                      {store.address && <p>{store.address}</p>}
                      {store.location && <p>{store.location}</p>}
                      <p>
                        {[store.city, store.state, store.country]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                      {store.postal_code && <p>{store.postal_code}</p>}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm italic text-gray-400">
                      No address on file
                    </p>
                  )}
                  {store.phone && (
                    <p className="mt-2 text-xs text-gray-500">
                      Tel: {store.phone}
                    </p>
                  )}
                  <Link
                    href={`/tracking?location=${encodeURIComponent(store.id)}`}
                    className={`mt-auto pt-4 ${GHOST_LINK}`}
                  >
                    View orders →
                  </Link>
                </article>
              ))}

              {access.isOrgAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAddStore(true)}
                  className="flex w-72 shrink-0 flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-gray-200 p-6 text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-900"
                >
                  <PlusIcon className="h-6 w-6" />
                  <span className="mt-3 text-sm font-medium">
                    Add location
                  </span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ─── Add Location Modal ─── */}
      {showAddStore && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
          onClick={() => {
            setShowAddStore(false)
            setLocationResult(null)
          }}
        >
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-[32px] bg-white p-6 sm:rounded-[32px] sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-dm-sans text-2xl font-medium text-gray-900">
                Add location
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowAddStore(false)
                  setLocationResult(null)
                }}
                aria-label="Close modal"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            {locationResult?.success && (
              <div className="mb-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                {locationResult.message}
              </div>
            )}
            {locationResult?.errors && (
              <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-2 text-sm text-rose-800">
                {locationResult.errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}

            <form onSubmit={handleLocationSubmit} className="space-y-4">
              <Field
                label="Location name"
                name="storeName"
                required
                placeholder="e.g., Auckland Downtown"
              />
              <Field
                label="Phone"
                name="phone"
                type="tel"
                placeholder="e.g., 09 123 4567 or 021 123 4567"
                hint="NZ numbers will be formatted automatically"
              />

              <div className="border-t border-gray-100 pt-4">
                <h3 className={LABEL_CAP}>Shipping address</h3>
                <div className="mt-3 space-y-3">
                  <Field
                    label="Street address"
                    name="address1"
                    placeholder="123 Main Street"
                  />
                  <Field
                    label="Unit / Suite"
                    name="address2"
                    placeholder="Suite 100"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="City" name="city" placeholder="Auckland" />
                    <div>
                      <label
                        htmlFor="regionCode"
                        className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-gray-500"
                      >
                        Region
                      </label>
                      <select
                        id="regionCode"
                        name="regionCode"
                        className="w-full rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
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
                  <Field label="Postal code" name="zip" placeholder="1010" />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddStore(false)
                    setLocationResult(null)
                  }}
                  className="flex-1 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={locationSubmitting}
                  className="flex-1 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
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

// ─── Helpers ────────────────────────────────────────────────────────

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
  minLength,
  placeholder,
  hint,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
  minLength?: number
  placeholder?: string
  hint?: string
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-gray-500"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        className="w-full rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm transition-colors focus:border-gray-400 focus:bg-white focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function FieldStatic({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-900">{value}</p>
    </div>
  )
}

function BagIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
      />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M12 5v14m-7-7h14"
      />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  )
}
