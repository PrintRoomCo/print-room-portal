import { NextResponse } from 'next/server'
import { getPortalUser, getPortalCompanyAccess } from '@/lib/portal-data'

/**
 * GET /api/company-access
 * Returns the B2BCustomerAccess for the authenticated user.
 * Called by CompanyContext on the client side (fallback path — the provider is
 * seeded with server-rendered initialAccess and only fetches on a user/owner
 * mismatch). Delegates to getPortalCompanyAccess so it shares the same preview
 * handling and per-user cache as the server layout.
 */
export async function GET() {
  const access = await getPortalCompanyAccess()
  if (access) return NextResponse.json(access)

  // Preserve the original status split: unauthenticated -> 401, authenticated
  // but no B2B access -> 404. getPortalUser is request-cached (already resolved
  // inside getPortalCompanyAccess), so this is free.
  const user = await getPortalUser()
  if (!user) return NextResponse.json(null, { status: 401 })
  return NextResponse.json(null, { status: 404 })
}
