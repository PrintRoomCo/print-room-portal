'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TeamMemberRow } from '@/lib/team/members'
import {
  orderingPermissionOptions,
  defaultOrderingPermission,
  type MemberOrderingPermission,
  type TenantType,
} from '@/lib/team/ordering-permission'

// Customer-facing wording for the three ordering permissions. Chris asked for
// language consistent with the rest of the portal (Monday 2809639903): stock
// draws are "from stock on hand", reorders are raised "with purchase order".
const PERMISSION_LABELS: Record<MemberOrderingPermission, string> = {
  stock_only: 'Order from stock on hand',
  reorder_only: 'Order with purchase order',
  both: 'Order from stock on hand and purchase order',
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
        <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
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
              <span className="text-xs tracking-wide text-gray-500">Email *</span>
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
                <span className="text-xs tracking-wide text-gray-500">First name *</span>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs tracking-wide text-gray-500">Last name</span>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs tracking-wide text-gray-500">
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
              <span className="text-xs tracking-wide text-gray-500">
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
              <li key={m.user_id} className="py-3 text-sm">
                <div className="flex items-center justify-between">
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
                </div>
                {/* Location-manager: grant ≥1 branch to make this staff member a
                    branch manager. Org_admins never get grants (they see everything). */}
                {m.role === 'staff' && <MemberBranchGrants membershipId={m.membership_id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

interface BranchGrant {
  id: string
  name: string
  granted: boolean
}

/**
 * Org_admin control (the whole /users page is org_admin-gated) to manage which
 * branches a STAFF member manages. Loads and replace-set saves via the mirror
 * route app/api/team/members/[membershipId]/store-grants. Zero granted branches
 * = plain staff (feature off for that member).
 */
export function MemberBranchGrants({ membershipId }: { membershipId: string }) {
  const [stores, setStores] = useState<BranchGrant[] | null>(null)
  const [original, setOriginal] = useState<BranchGrant[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Collapsed by default so the members list stays short — orgs with many
  // branches (e.g. Anytime Fitness ~65) otherwise render a huge list per member.
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/team/members/${membershipId}/store-grants`)
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { stores?: BranchGrant[]; error?: string }
        if (!r.ok) throw new Error(body.error ?? `Load failed (${r.status})`)
        if (cancelled) return
        const rows = (body.stores ?? []).map((s) => ({ ...s }))
        setStores(rows)
        setOriginal(rows.map((s) => ({ ...s })))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [membershipId])

  const dirty =
    !!stores && !!original && stores.some((s, i) => s.granted !== original[i]?.granted)

  function toggle(id: string, next: boolean) {
    setStores((prev) => (prev ? prev.map((s) => (s.id === id ? { ...s, granted: next } : s)) : prev))
  }

  async function save() {
    if (!stores) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/team/members/${membershipId}/store-grants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeIds: stores.filter((s) => s.granted).map((s) => s.id) }),
      })
      const body = (await r.json().catch(() => ({}))) as { stores?: BranchGrant[]; error?: string }
      if (!r.ok) throw new Error(body.error ?? `Save failed (${r.status})`)
      const rows = (body.stores ?? []).map((s) => ({ ...s }))
      setStores(rows)
      setOriginal(rows.map((s) => ({ ...s })))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (error) return <p className="mt-2 text-xs text-red-700">{error}</p>
  if (!stores) return <p className="mt-2 text-xs text-gray-500">Loading branches…</p>
  if (stores.length === 0)
    return <p className="mt-2 text-xs text-gray-500">No branches to assign.</p>

  const grantedCount = stores.filter((s) => s.granted).length
  const needle = filter.trim().toLowerCase()
  const visible = needle
    ? stores.filter((s) => s.name.toLowerCase().includes(needle))
    : stores

  return (
    <div className="mt-3 rounded-xl border border-gray-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="text-xs font-medium tracking-wide text-gray-500">
          Branches this member manages
        </span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {grantedCount > 0 ? `${grantedCount} selected` : 'None'}
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-3">
          {stores.length > 8 && (
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter branches…"
              className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm"
            />
          )}
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {visible.length === 0 ? (
              <li className="text-xs text-gray-500">No branches match “{filter}”.</li>
            ) : (
              visible.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={s.granted}
                      onChange={(e) => toggle(s.id, e.target.checked)}
                    />
                    {s.name}
                  </label>
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="btn-secondary mt-2 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save branches'}
          </button>
        </div>
      )}
    </div>
  )
}
