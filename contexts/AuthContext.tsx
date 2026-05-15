'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

interface AuthContextType {
  user: User | null
  loading: boolean
  signIn: (
    email: string,
    password: string,
    captchaToken?: string
  ) => Promise<{ error: string | null }>
  requestEmailCode: (
    email: string,
    captchaToken?: string
  ) => Promise<{ error: string | null }>
  verifyEmailCode: (
    email: string,
    token: string
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode
  initialUser?: User | null
}) {
  const [user, setUser] = useState<User | null>(initialUser)
  const [loading, setLoading] = useState(!initialUser)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    let stale = false

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (stale) return
      setUser(session?.user ?? null)
      setLoading(false)
    })
      .catch(() => {
        if (stale) return
        setUser(null)
        setLoading(false)
      })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (stale) return
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      stale = true
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(
    async (email: string, password: string, captchaToken?: string) => {
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: captchaToken ? { captchaToken } : undefined,
      })
      if (error) {
        return { error: error.message }
      }
      return { error: null }
    },
    []
  )

  const requestEmailCode = useCallback(
    async (email: string, captchaToken?: string) => {
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          ...(captchaToken ? { captchaToken } : {}),
        },
      })
      if (error) return { error: error.message }
      return { error: null }
    },
    []
  )

  const verifyEmailCode = useCallback(
    async (email: string, token: string) => {
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      })
      if (error) return { error: error.message }
      return { error: null }
    },
    []
  )

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowser()
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, requestEmailCode, verifyEmailCode, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
