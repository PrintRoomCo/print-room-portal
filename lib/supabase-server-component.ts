import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Supabase client for server components and server actions.
 * Reads session from cookies (set by middleware).
 * Uses ANON_KEY so RLS policies apply to the authenticated user.
 */
export async function getSupabaseServerComponent() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // setAll can fail in server components (read-only).
            // This is fine — middleware handles the refresh.
          }
        },
      },
    }
  )
}
