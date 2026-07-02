// lib/monday/__tests__/updates.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../client', () => ({ mondayApiCall: vi.fn() }))
import { mondayApiCall } from '../client'
import { postItemUpdate } from '../updates'

const mockedCall = vi.mocked(mondayApiCall)
beforeEach(() => vi.resetAllMocks())

describe('postItemUpdate', () => {
  it('posts a create_update mutation and returns the new update id', async () => {
    mockedCall.mockResolvedValueOnce({ create_update: { id: 'upd-1' } })
    const id = await postItemUpdate('item-9', 'Manual invoice required')
    expect(id).toBe('upd-1')
    const [query, vars] = mockedCall.mock.calls[0]
    expect(query).toContain('create_update')
    expect(vars).toEqual({ itemId: 'item-9', body: 'Manual invoice required' })
  })

  it('returns null when Monday returns no update', async () => {
    mockedCall.mockResolvedValueOnce({ create_update: null })
    expect(await postItemUpdate('item-9', 'x')).toBeNull()
  })
})
