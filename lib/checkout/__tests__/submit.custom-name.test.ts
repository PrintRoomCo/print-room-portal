import { describe, it, expect } from 'vitest'
import { buildLineSnapshotUpdate } from '../submit'

describe('buildLineSnapshotUpdate — custom name', () => {
  it('includes line_custom_name when provided', () => {
    const u = buildLineSnapshotUpdate({ custom_name: 'Chris' }, [])
    expect(u).toMatchObject({ line_custom_name: 'Chris' })
  })
  it('sets null when custom_name is explicitly null', () => {
    const u = buildLineSnapshotUpdate({ custom_name: null }, [])
    expect(u.line_custom_name).toBeNull()
  })
  it('omits line_custom_name when the field is absent (legacy line)', () => {
    const u = buildLineSnapshotUpdate({}, [])
    expect('line_custom_name' in u).toBe(false)
  })
  it('still carries the location label alongside (no regression)', () => {
    const u = buildLineSnapshotUpdate({ location_label: 'MTF Avalon', custom_name: 'Chris' }, [])
    expect(u).toMatchObject({ line_location_label: 'MTF Avalon', line_custom_name: 'Chris' })
  })
})
