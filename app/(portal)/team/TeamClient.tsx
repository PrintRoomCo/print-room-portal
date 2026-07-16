'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TeamMemberRow } from '@/lib/team/members'
import {
  orderingPermissionOptions,
  defaultOrderingPermission,
  type MemberOrderingPermission,
  type TenantType,
} from '@/lib/team/ordering-permission'

const PERMISSION_LABELS: Record<MemberOrderingPermission, string> = {
  stock_only: 'Stock only',
  reorder_only: 'Reorder only',
  both: 'Both',
}

interface StoreOption {
  id: string
  name: string | null
}

interface TeamClientProps {
  organizationName: string
  tenantType: TenantType
  initialMembers: TeamMemberRow[]
  stores: StoreOption[]
}

export function TeamClient({
  organizationName,
  tenantType,
  initialMembers,
  stores,
}: TeamClientProps) {
  const router = useRouter()
  const permissionChoices = orderingPermissionOptions(tenantType)
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [defaultStoreId, setDefaultStoreId] = useState('')
  const [permission, setPermission] = useState<MemberOrderingPermission>(
    defaultOrderingPermission(tenantType),
  )
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const noStores = stores.length === 0
  const canSubmit =
    !busy && email.trim() !== '' && firstName.trim() !== '' && defaultStoreId !== ''
  // Deferred send: adding a member provisions them (invited_at NULL); the
  // sign-in email only goes out via the batch "Send invites (N)" button.
  const pendingSendCount = initialMembers.filter(
    (member) =>
      member.role === 'staff' &&
      member.status === 'pending' &&
      member.invited_at === null,
  ).length

  async function submitInvite() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const r = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          default_store_id: defaultStoreId,
          ordering_permission: permission,
        }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error ?? `Invite failed (${r.status})`)
      setMessage(
        `${email.trim().toLowerCase()} added — they'll get their sign-in email when you send invites.`,
      )
      setEmail('')
      setFirstName('')
      setLastName('')
      setDefaultStoreId('')
      setPermission(defaultOrderingPermission(tenantType))
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sendPendingInvites() {
    setSending(true)
    setError(null)
    setMessage(null)
    try {
      const r = await fetch('/api/team/invites/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = (await r.json().catch(() => ({}))) as {
        error?: string
        sent?: number
        failed?: number
      }
      if (!r.ok) throw new Error(body.error ?? `Send failed (${r.status})`)
      const sent = body.sent ?? 0
      const failed = body.failed ?? 0
      setMessage(
        `Sign-in email sent to ${sent} member${sent === 1 ? '' : 's'}${
          failed > 0 ? ` — ${failed} failed` : ''
        }.`,
      )
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Team</h1>
        <p className="mt-1 text-sm text-gray-500">
          Invite staff members to {organizationName}. Staff see only their own orders and
          ship to their default store.
        </p>
      </header>

      {message && (
        <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-700">{message}</p>
      )}
      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="card-elevated p-6">
        <h2 className="text-lg font-medium text-gray-900">Add a staff member</h2>
        {noStores ? (
          <p className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-orange-800">
            Add a store on your Account page before inviting staff — every staff member needs a
            default ship-to store.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-gray-500">Email *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="name@company.co.nz"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-gray-500">First name *</span>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-gray-500">Last name</span>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Default ship-to store *
              </span>
              <select
                value={defaultStoreId}
                onChange={(e) => setDefaultStoreId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select store…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? 'Store'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-gray-500">
                Ordering permission
              </span>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as MemberOrderingPermission)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                {permissionChoices.map((p) => (
                  <option key={p} value={p}>
                    {PERMISSION_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={submitInvite}
              disabled={!canSubmit}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add member'}
            </button>
          </div>
        )}
      </section>

      <section className="card-elevated p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium text-gray-900">Members</h2>
          {pendingSendCount > 0 && (
            <button
              type="button"
              onClick={sendPendingInvites}
              disabled={sending}
              className="btn-primary disabled:opacity-50"
            >
              {sending ? 'Sending…' : `Send invites (${pendingSendCount})`}
            </button>
          )}
        </div>
        {initialMembers.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No members yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {initialMembers.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{m.email}</p>
                  <p className="truncate text-gray-500">{m.full_name ?? '—'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                    {m.role === 'org_admin' ? 'Org admin' : 'Staff'}
                  </span>
                  <span
                    className={
                      m.status === 'active'
                        ? 'rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-700'
                        : m.invited_at
                          ? 'rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800'
                          : 'rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600'
                    }
                  >
                    {m.status === 'active' ? 'Active' : m.invited_at ? 'Invited' : 'Not emailed yet'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
