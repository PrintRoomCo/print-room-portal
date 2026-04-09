import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side Supabase client with ANON_KEY.
 * Use in client components ('use client').
 * RLS policies are enforced — user can only access their own data.
 */
export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
