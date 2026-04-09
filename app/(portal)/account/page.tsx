'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useCompany } from '@/contexts/CompanyContext'
import { updateProfile, changePasswordAction, createLocationAction, type ActionResult } from './actions'

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

export default function Account() {
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

  // Close profile edit on success
  useEffect(() => {
    if (profileResult?.success && editingProfile) {
      const timer = setTimeout(() => {
        setEditingProfile(false)
        window.location.reload()
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [profileResult, editingProfile])

  // Close password change on success
  useEffect(() => {
    if (passwordResult?.success && showPasswordChange) {
      const timer = setTimeout(() => {
        setShowPasswordChange(false)
        setPasswordResult(null)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [passwordResult, showPasswordChange])

  // Close location modal on success
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
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
        <p className="mt-1 text-gray-600">
          Manage your account settings and view your order history
        </p>
      </div>

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
            <AddressIcon />
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

      {/* Recent Quotes */}
      <div className="card-elevated">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Recent Quotes
            </h2>
            <Link href="/my-collections" className="text-sm text-[rgb(var(--color-primary))] hover:underline">
              View all quotes
            </Link>
          </div>
        </div>

        {recentQuotes.length ? (
          <div className="divide-y divide-gray-100">
            {recentQuotes.map((quote) => {
              const lineItems = Array.isArray(quote.line_items) ? quote.line_items : []
              return (
                <div
                  key={quote.id}
                  className="p-6 hover:bg-gray-50 transition-colors duration-300 block"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-4">
                        <h3 className="font-semibold text-gray-900">
                          Quote {quote.quote_number || '—'}
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
                        {quote.currency} ${Number(quote.total_amount).toFixed(2)}
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
              No quotes yet
            </h3>
            <p className="mt-2 text-gray-600">
              Your quote history will appear here
            </p>
          </div>
        )}
      </div>

      {/* Locations */}
      {access.isCompanyUser && (
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
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <Link
                    href={`/order-tracker?location=${encodeURIComponent(store.id)}`}
                    className="text-sm text-[rgb(var(--color-primary))] hover:underline"
                  >
                    View orders for this location
                  </Link>
                </div>
              </div>
            ))}

            {/* Add Location Card - Only for admins */}
            {access.isAdmin && (
              <button
                onClick={() => setShowAddStore(true)}
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

      {/* Add Location Modal */}
      {showAddStore && (
        <div className="glass-modal-backdrop">
          <div className="glass-modal-content max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Add New Location</h2>
                <button
                  onClick={() => { setShowAddStore(false); setLocationResult(null) }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Close modal"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {locationResult?.success && (
                <div className="glass-success-box p-3 mb-4">
                  <p className="text-sm">{locationResult.message}</p>
                </div>
              )}

              {locationResult?.errors && (
                <div className="glass-error-box p-3 mb-4">
                  {locationResult.errors.map((error, i) => (
                    <p key={i} className="text-sm">{error}</p>
                  ))}
                </div>
              )}

              <form onSubmit={handleLocationSubmit} className="space-y-4">
                <div>
                  <label htmlFor="storeName" className="block text-sm font-medium text-gray-700 mb-1">
                    Location Name *
                  </label>
                  <input
                    type="text"
                    id="storeName"
                    name="storeName"
                    required
                    placeholder="e.g., Auckland Downtown"
                    className="input-glass"
                  />
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    placeholder="e.g., 09 123 4567 or 021 123 4567"
                    className="input-glass"
                  />
                  <p className="text-xs text-gray-500 mt-1">NZ numbers will be formatted automatically</p>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">Shipping Address</h3>

                  <div className="space-y-3">
                    <div>
                      <label htmlFor="address1" className="block text-sm font-medium text-gray-700 mb-1">
                        Street Address
                      </label>
                      <input
                        type="text"
                        id="address1"
                        name="address1"
                        placeholder="123 Main Street"
                        className="input-glass"
                      />
                    </div>

                    <div>
                      <label htmlFor="address2" className="block text-sm font-medium text-gray-700 mb-1">
                        Unit / Suite (optional)
                      </label>
                      <input
                        type="text"
                        id="address2"
                        name="address2"
                        placeholder="Suite 100"
                        className="input-glass"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                          City
                        </label>
                        <input
                          type="text"
                          id="city"
                          name="city"
                          placeholder="Auckland"
                          className="input-glass"
                        />
                      </div>

                      <div>
                        <label htmlFor="regionCode" className="block text-sm font-medium text-gray-700 mb-1">
                          Region
                        </label>
                        <select
                          id="regionCode"
                          name="regionCode"
                          className="input-glass"
                        >
                          <option value="">Select region...</option>
                          {NZ_REGIONS.map((region) => (
                            <option key={region.code} value={region.code}>
                              {region.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="zip" className="block text-sm font-medium text-gray-700 mb-1">
                        Postal Code
                      </label>
                      <input
                        type="text"
                        id="zip"
                        name="zip"
                        placeholder="1010"
                        className="input-glass"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => { setShowAddStore(false); setLocationResult(null) }}
                    className="flex-1 btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={locationSubmitting}
                    className="flex-1 btn-primary"
                  >
                    {locationSubmitting ? 'Creating...' : 'Create Location'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
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
