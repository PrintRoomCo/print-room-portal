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
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined)

/**
 * CompanyProvider loads the B2BCustomerAccess after the user authenticates.
 * It fetches via an API route to avoid importing server-only code into the client.
 */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [access, setAccess] = useState<B2BCustomerAccess | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      setAccess(null)
      setLoading(false)
      return
    }

    // Fetch company access from API route
    fetch('/api/company-access')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setAccess(data)
        setLoading(false)
      })
      .catch(() => {
        setAccess(null)
        setLoading(false)
      })
  }, [user, authLoading])

  return (
    <CompanyContext.Provider value={{ access, loading }}>
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
