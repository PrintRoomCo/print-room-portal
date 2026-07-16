import { describe, it, expect } from 'vitest'
import { INVITABLE_ROLES, isInvitableRole } from '../invite-guard'

describe('customer-portal invite role guard', () => {
  it('admits staff', () => {
    expect(isInvitableRole('staff')).toBe(true)
    expect(INVITABLE_ROLES.has('staff')).toBe(true)
  })
  it('NEVER admits org_admin (a portal admin cannot mint another admin)', () => {
    expect(isInvitableRole('org_admin')).toBe(false)
  })
  it('rejects unknown / legacy roles', () => {
    expect(isInvitableRole('buyer')).toBe(false)
    expect(isInvitableRole('')).toBe(false)
  })
})
