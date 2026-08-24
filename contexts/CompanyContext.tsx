'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import type { B2BCustomerAccess } from '@/types/company'

interface CompanyContextType {
  access: B2BCustomerAccess | null
  loading: boolean
  countryPartitionEnabled: boolean
  defaultBillingCountryCode: string | null
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined)

/**
 * CompanyProvider loads the B2BCustomerAccess after the user authenticates.
 * It fetches via an API route to avoid importing server-only code into the client.
 */
export function CompanyProvider({
  children,
  initialAccess = null,
  initialUserId = null,
  countryPartitionEnabled = false,
  defaultBillingCountryCode = null,
}: {
  children: ReactNode
  initialAccess?: B2BCustomerAccess | null
  initialUserId?: string | null
  countryPartitionEnabled?: boolean
  defaultBillingCountryCode?: string | null
}) {
  const { user, loading: authLoading } = useAuth()
  const [access, setAccess] = useState<B2BCustomerAccess | null>(initialAccess)
  const [accessUserId, setAccessUserId] = useState<string | null>(
    initialAccess?.userId ?? initialUserId,
  )
  const [loading, setLoading] = useState(!initialAccess)

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      setAccess(null)
      setAccessUserId(null)
      setLoading(false)
      return
    }

    if (access && accessUserId === user.id) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let stale = false

    setAccess(null)
    setAccessUserId(user.id)
    setLoading(true)

    fetch('/api/company-access', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (stale) return
        setAccess(data)
        setAccessUserId(user.id)
        setLoading(false)
      })
      .catch((error) => {
        if (stale || error?.name === 'AbortError') return
        setAccess(null)
        setAccessUserId(user.id)
        setLoading(false)
      })

    return () => {
      stale = true
      controller.abort()
    }
  }, [user, authLoading, access, accessUserId])

  return (
    <CompanyContext.Provider
      value={{
        access,
        loading,
        countryPartitionEnabled,
        defaultBillingCountryCode,
      }}
    >
      {children}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  const context = useContext(CompanyContext)
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider')
  }
  return context
}
