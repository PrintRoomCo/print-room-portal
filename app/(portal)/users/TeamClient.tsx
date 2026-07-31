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
          <div className="mt-4 space-y-3">
            {initialMembers.map((m) => (
              <div
                key={m.user_id}
                className="rounded-2xl border border-gray-100 p-4 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
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
              </div>
            ))}
          </div>
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
  // Combobox: granted branches show as chips; the input searches the rest.
  // Orgs can have ~65 branches, so a checkbox-per-branch list is unusable.
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

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

  // Close the search dropdown when clicking anywhere outside this control.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

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

  const granted = stores.filter((s) => s.granted)
  const needle = query.trim().toLowerCase()
  const matches = stores.filter(
    (s) => !s.granted && (!needle || s.name.toLowerCase().includes(needle)),
  )

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-gray-500">
          Branches this member manages
        </p>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {granted.length > 0 ? `${granted.length} selected` : 'None'}
        </span>
      </div>

      {/* Selected branches as removable mint chips */}
      {granted.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {granted.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center rounded-full bg-[rgb(var(--accent-mint))] text-black transition-colors"
            >
              <button
                type="button"
                onClick={() => toggle(s.id, false)}
                aria-label={`Remove ${s.name}`}
                title="Remove branch"
                className="inline-flex items-center gap-1.5 rounded-full py-1 pl-3 pr-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30"
              >
                <span className="text-[12px] font-medium">{s.name}</span>
                <svg
                  className="h-3.5 w-3.5 text-black/60"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l8 8M14 6l-8 8" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search + add combobox */}
      <div ref={boxRef} className="relative mt-2">
        <input
          type="search"
          value={query}
          aria-label="Add a branch this member manages"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          placeholder="Add a branch…"
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
        />
        {open && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">

            {matches.length === 0 ? (
              <li className="px-3 py-2 text-xs text-gray-500">
                {needle ? `No branches match “${query}”.` : 'All branches added.'}
              </li>
            ) : (
              matches.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      toggle(s.id, true)
                      setQuery('')
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-gray-400"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M10 5v10M5 10h10" />
                    </svg>
                    {s.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving}
        className="btn-secondary mt-2 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save branches'}
      </button>
    </div>
  )
}
