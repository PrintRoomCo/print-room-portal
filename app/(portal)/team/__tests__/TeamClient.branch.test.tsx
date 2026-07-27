import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { MemberBranchGrants } from '../TeamClient'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

let lastPut: { url: string; body: unknown } | null = null

beforeEach(() => {
  lastPut = null
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      lastPut = { url: String(url), body: JSON.parse(String(init.body)) }
      return {
        ok: true,
        json: async () => ({
          stores: [
            { id: 's-1', name: 'Avalon', granted: true },
            { id: 's-2', name: 'CBD', granted: true },
          ],
        }),
      } as Response
    }
    return {
      ok: true,
      json: async () => ({
        stores: [
          { id: 's-1', name: 'Avalon', granted: true },
          { id: 's-2', name: 'CBD', granted: false },
        ],
      }),
    } as Response
  }) as unknown as typeof fetch
})

describe('MemberBranchGrants', () => {
  it('renders the org stores with their granted state', async () => {
    render(<MemberBranchGrants membershipId="m-1" />)
    await waitFor(() => expect(screen.getByLabelText('Avalon')).toBeTruthy())
    expect((screen.getByLabelText('Avalon') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('CBD') as HTMLInputElement).checked).toBe(false)
  })

  it('saves the checked branch ids to the mirror route', async () => {
    render(<MemberBranchGrants membershipId="m-1" />)
    await waitFor(() => expect(screen.getByLabelText('CBD')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('CBD')) // now both checked
    fireEvent.click(screen.getByRole('button', { name: /save branches/i }))
    await waitFor(() => expect(lastPut).not.toBeNull())
    expect(lastPut?.url).toContain('/api/team/members/m-1/store-grants')
    expect(lastPut?.body).toEqual({ storeIds: ['s-1', 's-2'] })
  })
})
