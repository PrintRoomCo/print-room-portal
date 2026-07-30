// Portal-local member-row builder for the /users page (org_admin self-serve).
// Pure + DB-free so it is unit-testable. profiles.last_sign_in_at is mirrored
// from auth.users by the shared-DB trigger, so no Auth-admin call is needed.

export interface TeamMemberRow {
  /** user_organizations.id — the membership row id (keys the store-grants route). */
  membership_id: string
  user_id: string
  email: string
  full_name: string | null
  role: string
  status: 'pending' | 'active'
  default_store_id: string | null
  invited_at: string | null
}

export interface TeamMembership {
  id: string
  user_id: string
  role: string
  default_store_id: string | null
  invited_at: string | null
}

export interface TeamProfile {
  id: string
  email: string | null
  full_name: string | null
  last_sign_in_at: string | null
}

function blankToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function buildTeamMemberRow(
  membership: TeamMembership,
  profile: TeamProfile | undefined,
): TeamMemberRow {
  const lastSignIn = profile?.last_sign_in_at ?? null
  return {
    membership_id: membership.id,
    user_id: membership.user_id,
    email: blankToNull(profile?.email) ?? '(unknown)',
    full_name: blankToNull(profile?.full_name),
    role: membership.role,
    status: lastSignIn ? 'active' : 'pending',
    default_store_id: membership.default_store_id,
    invited_at: membership.invited_at,
  }
}
