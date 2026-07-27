import { describe, it, expect } from 'vitest'
import { buildTeamMemberRow } from '../members'

describe('buildTeamMemberRow', () => {
  it('marks a member who has signed in as active', () => {
    const row = buildTeamMemberRow(
      { id: 'uo1', user_id: 'u1', role: 'staff', default_store_id: 's1', invited_at: null },
      { id: 'u1', email: 'a@b.co', full_name: 'Ann B', last_sign_in_at: '2026-07-01T00:00:00Z' },
    )
    expect(row.status).toBe('active')
    expect(row.full_name).toBe('Ann B')
  })

  it('marks a provisioned-but-never-signed-in member as pending, blank name → null', () => {
    const row = buildTeamMemberRow(
      { id: 'uo2', user_id: 'u2', role: 'staff', default_store_id: 's1', invited_at: '2026-07-02T00:00:00Z' },
      { id: 'u2', email: 'c@d.co', full_name: '  ', last_sign_in_at: null },
    )
    expect(row.status).toBe('pending')
    expect(row.full_name).toBeNull()
  })

  it('falls back to (unknown) email when the profile is missing', () => {
    const row = buildTeamMemberRow(
      { id: 'uo3', user_id: 'u3', role: 'staff', default_store_id: null, invited_at: null },
      undefined,
    )
    expect(row.email).toBe('(unknown)')
  })
})
