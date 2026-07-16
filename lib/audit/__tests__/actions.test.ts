import { describe, it, expect } from 'vitest'
import { AUDIT_ACTIONS } from '../actions'

describe('AUDIT_ACTIONS', () => {
  it('mirrors the staff member.invite action string', () => {
    expect(AUDIT_ACTIONS.MEMBER_INVITE).toBe('member.invite')
  })
})
