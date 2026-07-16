import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TeamClient } from '../TeamClient'
import type { TeamMemberRow } from '@/lib/team/members'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

function member(over: Partial<TeamMemberRow> = {}): TeamMemberRow {
  return {
    user_id: 'u1',
    email: 'a@b.co',
    full_name: null,
    role: 'staff',
    status: 'pending',
    default_store_id: 's1',
    invited_at: null,
    ...over,
  }
}

describe('TeamClient', () => {
  it('blocks inviting until the org has a store', () => {
    render(
      <TeamClient organizationName="Acme" tenantType="franchise" initialMembers={[]} stores={[]} />,
    )
    expect(screen.getByText(/add a store/i)).toBeTruthy()
  })

  it('disables Add member until email, first name and store are chosen', () => {
    render(
      <TeamClient
        organizationName="Acme"
        tenantType="franchise"
        initialMembers={[]}
        stores={[{ id: 's1', name: 'HQ' }]}
      />,
    )
    const btn = screen.getByRole('button', { name: /add member/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('shows Send invites (N) counting members not yet emailed, hides it when none', () => {
    const { rerender } = render(
      <TeamClient
        organizationName="Acme"
        tenantType="franchise"
        initialMembers={[member(), member({ user_id: 'u2', email: 'c@d.co' })]}
        stores={[{ id: 's1', name: 'HQ' }]}
      />,
    )
    expect(screen.getByRole('button', { name: /send invites \(2\)/i })).toBeTruthy()

    rerender(
      <TeamClient
        organizationName="Acme"
        tenantType="franchise"
        initialMembers={[member({ invited_at: '2026-07-01T00:00:00Z' })]}
        stores={[{ id: 's1', name: 'HQ' }]}
      />,
    )
    expect(screen.queryByRole('button', { name: /send invites/i })).toBeNull()
  })

  it('scopes ordering permissions to the tenant (studio → reorder only)', () => {
    render(
      <TeamClient
        organizationName="Studio X"
        tenantType="studio"
        initialMembers={[]}
        stores={[{ id: 's1', name: 'HQ' }]}
      />,
    )
    expect(screen.queryByRole('option', { name: /stock only/i })).toBeNull()
    expect(screen.getByRole('option', { name: /reorder only/i })).toBeTruthy()
  })
})
