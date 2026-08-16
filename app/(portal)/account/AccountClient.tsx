'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'
import { CurrencyDisplayPreferenceSection } from '@/components/account/CurrencyDisplayPreferenceSection'
import { LocationFormModal } from '@/components/account/LocationFormModal'
import {
  updateProfile,
  changePasswordAction,
  updateOrgLogoAction,
  removeOrgLogoAction,
  type ActionResult,
} from './actions'
import { formatPrice } from '@/lib/format/price'
import { formatCurrency } from '@/lib/currency/format'
import type { SupportedCurrency } from '@/lib/currency/types'
import { getPortalOwnerKey } from '@/lib/portal-owner'
import type { PortalAccountData } from '@/lib/portal-data'

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
  line_items?: unknown[] | null
  created_at: string
}

interface AccountClientProps {
  ratesFetchedAt: string | null
  initialData: PortalAccountData
}

export function AccountClient({ ratesFetchedAt, initialData }: AccountClientProps) {
  const { access, loading: companyLoading } = useCompany()
  const currentOwnerKey = getPortalOwnerKey(access)

  const [stores, setStores] = useState<Store[]>(initialData.stores)
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>(initialData.recentQuotes)
  const [dataOwnerKey, setDataOwnerKey] = useState(initialData.ownerKey)
  const [dataLoading, setDataLoading] = useState(false)

  const [locationModal, setLocationModal] = useState<
    { mode: 'add' } | { mode: 'edit'; store: Store } | null
  >(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [showPasswordChange, setShowPasswordChange] = useState(false)

  const [profileResult, setProfileResult] = useState<ActionResult | null>(null)
  const [profileSubmitting, setProfileSubmitting] = useState(false)

  const [passwordResult, setPasswordResult] = useState<ActionResult | null>(null)
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)

  const [logoResult, setLogoResult] = useState<ActionResult | null>(null)
  const [logoSubmitting, setLogoSubmitting] = useState(false)

  const fetchAccountData = useCallback((signal?: AbortSignal) => {
    return fetch('/api/account-data', { signal })
      .then((res) => (res.ok ? res.json() : { stores: [], recentQuotes: [] }))
      .then((data: PortalAccountData) => {
        setStores(data.stores || [])
        setRecentQuotes(data.recentQuotes || [])
        setDataOwnerKey(data.ownerKey ?? currentOwnerKey)
        setDataLoading(false)
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return
        setStores([])
        setRecentQuotes([])
        setDataOwnerKey(currentOwnerKey)
        setDataLoading(false)
      })
  }, [currentOwnerKey])

  useEffect(() => {
    if (companyLoading) return

    if (!currentOwnerKey) {
      setStores([])
      setRecentQuotes([])
      setDataOwnerKey(null)
      setDataLoading(false)
      return
    }

    if (currentOwnerKey === dataOwnerKey) {
      setDataLoading(false)
      return
    }

    const controller = new AbortController()
    setStores([])
    setRecentQuotes([])
    setDataLoading(true)
    fetchAccountData(controller.signal)
    return () => controller.abort()
  }, [companyLoading, currentOwnerKey, dataOwnerKey, fetchAccountData])

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

  // The header logo is read from company-access (cached in CompanyContext), so a
  // full reload is the simplest way to repaint it after a change — same approach
  // the profile save uses above.
  useEffect(() => {
    if (logoResult?.success) {
      const timer = setTimeout(() => window.location.reload(), 1200)
      return () => clearTimeout(timer)
    }
  }, [logoResult])

  async function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (profileSubmitting) return
    setProfileSubmitting(true)
    setProfileResult(null)
    const formData = new FormData(e.currentTarget)
    const result = await updateProfile(formData)
    setProfileResult(result)
    setProfileSubmitting(false)
  }

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (passwordSubmitting) return
    setPasswordSubmitting(true)
    setPasswordResult(null)
    const formData = new FormData(e.currentTarget)
    const result = await changePasswordAction(formData)
    setPasswordResult(result)
    setPasswordSubmitting(false)
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset the input so re-selecting the same file still fires onChange.
    e.target.value = ''
    if (!file || logoSubmitting) return
    setLogoSubmitting(true)
    setLogoResult(null)
    const formData = new FormData()
    formData.set('logo', file)
    const result = await updateOrgLogoAction(formData)
    setLogoResult(result)
    setLogoSubmitting(false)
  }

  async function handleLogoRemove() {
    if (logoSubmitting) return
    setLogoSubmitting(true)
    setLogoResult(null)
    const result = await removeOrgLogoAction()
    setLogoResult(result)
    setLogoSubmitting(false)
  }

  if (dataLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 bg-gray-200 rounded-2xl" />
            <div className="h-64 bg-gray-200 rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!access) return null

  const primaryStore = stores[0] || null

  return (
    <div className="max-w-7xl mx-auto space-y-6 motion-safe:animate-portal-enter">
      {/* Header */}
      <header className="mb-10 md:mb-12">
        <h1 className="mt-2 font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
          My Account
        </h1>
      </header>

      {/* Account Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Information */}
        <div className="card-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Profile Information
            </h2>
            {!editingProfile ? (
              <button
                type="button"
                onClick={() => setEditingProfile(true)}
                className="text-sm text-[rgb(var(--color-primary))] hover:underline"
              >
                Edit
              </button>
            ) : (
              <UserIcon />
            )}
          </div>

          {profileResult?.success && (
            <div className="glass-success-box p-3 mb-4">
              <p className="text-sm">{profileResult.message}</p>
            </div>
          )}
          {profileResult?.errors && (
            <div className="glass-error-box p-3 mb-4">
              {profileResult.errors.map((error, i) => (
                <p key={i} className="text-sm">{error}</p>
              ))}
            </div>
          )}

          {editingProfile ? (
            <form onSubmit={handleProfileSubmit} className="space-y-3">
              <div>
                <label htmlFor="firstName" className="text-sm text-gray-500">First Name</label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  defaultValue={access.firstName}
                  required
                  className="input-glass mt-1"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="text-sm text-gray-500">Last Name</label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  defaultValue={access.lastName}
                  required
                  className="input-glass mt-1"
                />
              </div>
              <div>
                <label className="text-sm text-gray-500">Email</label>
                <p className="text-gray-900 font-medium">{access.email}</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setEditingProfile(false); setProfileResult(null) }}
                  className="flex-1 btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={profileSubmitting} className="flex-1 btn-primary">
                  {profileSubmitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-500">Name</label>
                <p className="text-gray-900 font-medium">
                  {access.firstName} {access.lastName}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-500">Email</label>
                <p className="text-gray-900 font-medium">{access.email}</p>
              </div>
              {access.companyName && (
                <div>
                  <label className="text-sm text-gray-500">Company</label>
                  <p className="text-gray-900 font-medium">
                    {access.companyName}
                  </p>
                </div>
              )}
              <div>
                <label className="text-sm text-gray-500">Account Type</label>
                <p className="text-gray-900 font-medium capitalize">
                  {access.role}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Default Address */}
        <div className="card-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Default Address
            </h2>
            <div className="flex items-center gap-3">
              {access.isOrgAdmin && primaryStore && (
                <button
                  type="button"
                  onClick={() => setLocationModal({ mode: 'edit', store: primaryStore })}
                  className="text-sm text-[rgb(var(--color-primary))] hover:underline"
                >
                  Edit
                </button>
              )}
              <AddressIcon />
            </div>
          </div>
          {primaryStore && (primaryStore.address || primaryStore.city) ? (
            <div className="text-gray-900">
              <p className="font-medium">{primaryStore.name}</p>
              {primaryStore.address && (
                <p className="mt-2 text-gray-600">{primaryStore.address}</p>
              )}
              {primaryStore.location && (
                <p className="text-gray-600">{primaryStore.location}</p>
              )}
              <p className="text-gray-600">
                {[primaryStore.city, primaryStore.state, primaryStore.country]
                  .filter(Boolean)
                  .join(', ')}
              </p>
              {primaryStore.postal_code && (
                <p className="text-gray-600">{primaryStore.postal_code}</p>
              )}
              {primaryStore.phone && (
                <p className="text-gray-500 mt-2 text-sm">Tel: {primaryStore.phone}</p>
              )}
            </div>
          ) : (
            <p className="text-gray-500">No default address set</p>
          )}
        </div>
      </div>

      {/* Organisation Logo — org admins only. Replaces the Print Room mark in
          the top header bar for everyone in the org. */}
      {access.isCompanyUser && access.isOrgAdmin && (
        <div className="card-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Organisation Logo</h2>
          </div>

          {logoResult?.success && (
            <div className="glass-success-box p-3 mb-4">
              <p className="text-sm">{logoResult.message}</p>
            </div>
          )}
          {logoResult?.errors && (
            <div className="glass-error-box p-3 mb-4">
              {logoResult.errors.map((error, i) => (
                <p key={i} className="text-sm">{error}</p>
              ))}
            </div>
          )}

          <div className="flex items-center gap-5">
            <div className="flex h-16 w-32 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 p-2">
              {access.logoUrl ? (
                <Image
                  src={access.logoUrl}
                  alt={access.companyName ?? 'Organisation logo'}
                  width={128}
                  height={64}
                  unoptimized
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-center text-xs text-gray-400">
                  Using the Print Room default
                </span>
              )}
            </div>

            <div className="flex-1 space-y-2">
              <p className="text-sm text-gray-600">
                Shown in the header instead of the Print Room logo. PNG, JPG, WebP, or SVG, up to 2&nbsp;MB.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className={`btn-secondary cursor-pointer ${logoSubmitting ? 'pointer-events-none opacity-60' : ''}`}
                >
                  {logoSubmitting ? 'Uploading…' : access.logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sr-only"
                    onChange={handleLogoChange}
                    disabled={logoSubmitting}
                  />
                </label>
                {access.logoUrl && (
                  <button
                    type="button"
                    onClick={handleLogoRemove}
                    disabled={logoSubmitting}
                    className="text-sm text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-60"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AU Stage 1: an AU org has nothing to choose — their prices ARE AUD, not
          conversions of an NZD base, and the provider is pinned. */}
      {access?.region !== 'AU' && (
        <CurrencyDisplayPreferenceSection fetchedAt={ratesFetchedAt} />
      )}

      {/* Password Change */}
      <div className="card-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Security</h2>
          {!showPasswordChange && (
            <button
              type="button"
              onClick={() => setShowPasswordChange(true)}
              className="text-sm text-[rgb(var(--color-primary))] hover:underline"
            >
              Change Password
            </button>
          )}
        </div>

        {passwordResult?.success && (
          <div className="glass-success-box p-3 mb-4">
            <p className="text-sm">{passwordResult.message}</p>
          </div>
        )}
        {passwordResult?.errors && (
          <div className="glass-error-box p-3 mb-4">
            {passwordResult.errors.map((error, i) => (
              <p key={i} className="text-sm">{error}</p>
            ))}
          </div>
        )}

        {showPasswordChange ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div>
              <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Current Password
              </label>
              <input type="password" id="currentPassword" name="currentPassword" required className="input-glass" />
            </div>
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
                New Password
              </label>
              <input type="password" id="newPassword" name="newPassword" required minLength={8} className="input-glass" />
              <p className="text-xs text-gray-500 mt-1">Min 8 chars, with uppercase, lowercase, and a number</p>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm New Password
              </label>
              <input type="password" id="confirmPassword" name="confirmPassword" required minLength={8} className="input-glass" />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowPasswordChange(false); setPasswordResult(null) }}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={passwordSubmitting} className="flex-1 btn-primary">
                {passwordSubmitting ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-gray-500">
            Use a strong, unique password to protect your account.
          </p>
        )}
      </div>

      {/* Recent Orders — hidden for now (2026-06-26): flip this guard to true to restore. */}
      {false && (
      <div className="card-elevated">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Recent Orders
            </h2>
            <Link href="/past-orders" className="text-sm text-[rgb(var(--color-primary))] hover:underline">
              View all orders
            </Link>
          </div>
        </div>

        {recentQuotes.length ? (
          <div className="divide-y divide-gray-100">
            {recentQuotes.map((quote) => {
              const lineItems = Array.isArray(quote.line_items) ? quote.line_items : []
              const totalAmount = Number(quote.total_amount)
              const totalLabel =
                Number.isFinite(totalAmount) && totalAmount > 0
                  ? formatCurrency(totalAmount, (quote.currency || 'NZD') as SupportedCurrency)
                  : formatPrice(quote.total_amount)
              return (
                <div
                  key={quote.id}
                  className="p-6 hover:bg-gray-50 transition-colors duration-300 block"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-4">
                        <h3 className="font-semibold text-gray-900">
                          Order {quote.quote_number || '—'}
                        </h3>
                        <QuoteStatusBadge status={quote.status} />
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {new Date(quote.created_at).toLocaleDateString()}
                      </p>
                      <p className="mt-2 text-sm text-gray-500">
                        {lineItems.length} item{lineItems.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">
                        {totalLabel}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="p-12 text-center">
            <OrderEmptyIcon />
            <h3 className="mt-4 text-lg font-semibold text-gray-900">
              No orders yet
            </h3>
            <p className="mt-2 text-gray-600">
              Your order history will appear here
            </p>
          </div>
        )}
      </div>
      )}

      {/* Locations — org admins only (staff cannot view locations or the
          admin-only order tracker the "View orders" link points to) */}
      {access.canViewLocations && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Locations</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stores.map((store) => (
              <div key={store.id} className="card-elevated p-6">
                <h3 className="font-semibold text-gray-900">{store.name}</h3>
                {store.address || store.city ? (
                  <>
                    {store.address && (
                      <p className="text-sm text-gray-500 mt-1">{store.address}</p>
                    )}
                    {store.location && (
                      <p className="text-sm text-gray-500">{store.location}</p>
                    )}
                    <p className="text-sm text-gray-500">
                      {[store.city, store.state, store.country]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                    {store.postal_code && (
                      <p className="text-sm text-gray-500">{store.postal_code}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-400 mt-1 italic">No address on file</p>
                )}
                {store.phone && (
                  <p className="text-sm text-gray-500 mt-2">Tel: {store.phone}</p>
                )}
                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
                  <Link
                    href={`/tracking?location=${encodeURIComponent(store.id)}`}
                    className="text-sm text-[rgb(var(--color-primary))] hover:underline"
                  >
                    View orders for this location
                  </Link>
                  {access.isOrgAdmin && (
                    <button
                      type="button"
                      onClick={() => setLocationModal({ mode: 'edit', store })}
                      className="text-sm text-[rgb(var(--color-primary))] hover:underline"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Add Location Card - Only for org admins */}
            {access.isOrgAdmin && (
              <button
                onClick={() => setLocationModal({ mode: 'add' })}
                className="card-elevated p-6 border-2 border-dashed border-gray-200 hover:border-[rgb(var(--color-primary))]/30 flex flex-col items-center justify-center text-center min-h-[200px] cursor-pointer group transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-[rgb(var(--color-primary))]/10 flex items-center justify-center mb-3 transition-colors">
                  <svg className="w-6 h-6 text-gray-400 group-hover:text-[rgb(var(--color-primary))] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-700 group-hover:text-[rgb(var(--color-primary))] transition-colors">Add New Location</h3>
                <p className="text-sm text-gray-500 mt-1">Create a new location for your company</p>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Location Modal (shared) */}
      {locationModal && (
        <LocationFormModal
          mode={locationModal.mode}
          store={locationModal.mode === 'edit' ? locationModal.store : null}
          onClose={() => setLocationModal(null)}
          onSaved={() => fetchAccountData()}
        />
      )}
    </div>
  )
}

function QuoteStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    approved: 'glass-badge-green',
    sent: 'glass-badge-blue',
    draft: 'glass-badge-gray',
    pending: 'glass-badge-yellow',
    rejected: 'glass-badge-red',
    expired: 'glass-badge-red',
  }

  const color = colors[status] || 'glass-badge-gray'

  return (
    <span className={color}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function UserIcon() {
  return (
    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
      <svg
        className="w-5 h-5 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    </div>
  )
}

function AddressIcon() {
  return (
    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
      <svg
        className="w-5 h-5 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </div>
  )
}

function OrderEmptyIcon() {
  return (
    <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center">
      <svg
        className="w-8 h-8 text-gray-400"
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
    </div>
  )
}
