import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('shows granted branches as chips and leaves ungranted ones out', async () => {
    render(<MemberBranchGrants membershipId="m-1" />)
    expect(await screen.findByRole('button', { name: 'Remove Avalon' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove CBD' })).toBeNull()
  })

  it('PUTs the granted branch ids to the mirror route when a branch is added', async () => {
    const user = userEvent.setup()
    render(<MemberBranchGrants membershipId="m-1" />)
    await screen.findByRole('button', { name: 'Remove Avalon' })

    expect(screen.getByRole('button', { name: 'Save branches' })).toBeDisabled()

    await user.click(screen.getByLabelText('Add a branch this member manages'))
    await user.click(await screen.findByRole('button', { name: 'CBD' }))
    await user.click(screen.getByRole('button', { name: 'Save branches' }))

    await waitFor(() => expect(lastPut).not.toBeNull())
    expect(lastPut?.url).toContain('/api/team/members/m-1/store-grants')
    expect(lastPut?.body).toEqual({ storeIds: ['s-1', 's-2'] })
  })
})
