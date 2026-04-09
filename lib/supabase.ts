import { createClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase client with SERVICE_ROLE_KEY.
 * Use only in server components, server actions, and route handlers.
 * Never import this in client components.
 */
export function getSupabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
