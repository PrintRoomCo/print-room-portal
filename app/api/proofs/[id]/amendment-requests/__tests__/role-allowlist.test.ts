import { describe, it, expect } from 'vitest'
import { ALLOWED_ROLES } from '../route'

describe('proof amendment-requests role allow-list', () => {
  it('admits staff and org_admin, not the legacy buyer literal', () => {
    expect(ALLOWED_ROLES.has('staff')).toBe(true)
    expect(ALLOWED_ROLES.has('org_admin')).toBe(true)
    expect(ALLOWED_ROLES.has('buyer')).toBe(false)
  })
})
