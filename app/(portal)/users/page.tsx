import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase'
import { getPortalUser, getPortalCompanyAccess } from '@/lib/portal-data'
import { buildTeamMemberRow, type TeamProfile } from '@/lib/team/members'
import { TeamClient } from './TeamClient'

export const metadata: Metadata = { title: 'Users' }

export default async function TeamPage() {
  // Reuse the layout's request-cached identity/access instead of re-issuing an
  // auth round-trip and a second access resolution for this page.
  const user = await getPortalUser()
  if (!user) redirect('/sign-in')

  const access = await getPortalCompanyAccess()
  // canManageUsers is the F2 gate: only a company org_admin reaches this page.
  if (!access || !access.canManageUsers || !access.companyId) redirect('/account')

  const admin = getSupabaseServer()
  const orgId = access.companyId

  const [{ data: memberships }, { data: stores }] = await Promise.all([
    admin
      .from('user_organizations')
      .select('id, user_id, role, default_store_id, invited_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true }),
    admin.from('stores').select('id, name').eq('organization_id', orgId).order('name'),
  ])

  const userIds = (memberships ?? []).map((m) => m.user_id)
  const { data: profiles } = userIds.length
    ? await admin
        .from('profiles')
        .select('id, email, full_name, last_sign_in_at')
        .in('id', userIds)
    : { data: [] as TeamProfile[] }

  const profileById = new Map(
    (profiles ?? []).map((p) => [(p as TeamProfile).id, p as TeamProfile]),
  )
  const members = (memberships ?? []).map((m) => buildTeamMemberRow(m, profileById.get(m.user_id)))

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-6 pt-[120px] pb-16">
        <TeamClient
          organizationName={access.companyName ?? 'your organisation'}
          tenantType={access.tenantType}
          initialMembers={members}
          stores={(stores ?? []) as { id: string; name: string | null }[]}
        />
      </div>
    </div>
  )
}
