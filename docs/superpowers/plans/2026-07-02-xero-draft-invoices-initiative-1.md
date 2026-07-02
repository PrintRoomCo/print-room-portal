# Xero Draft Invoices (Initiative 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On customer-portal order placement, auto-create a Xero **ACCREC DRAFT** invoice for fully-billable orders; flag every other order for manual invoicing — never blocking or failing the order.

**Architecture:** A new `lib/xero/` module (config → client → pure eligibility predicate → pure payload builder → contact resolver → orchestrator) is invoked as a best-effort side-effect (new step 5c) inside `submitCustomerOrder`, mirroring the existing Monday/email side-effects (try/catch, audit on failure, never throw). Eligibility is a pure function; the Xero HTTP client is mocked in every unit test.

**Tech Stack:** TypeScript, Next.js 16 App Router, Supabase (service-role admin client), Vitest, Xero Accounting API v2 (Custom Connection / OAuth2 `client_credentials`).

---

## Deviation from the spec (read first)

The spec's eligibility rule #5 says "every line has `quote_items.qty_from_stock == 0`." **Verified false as a data source:** `submitCustomerOrder`'s RPC payload ([lib/checkout/submit.ts:909-941](../../../lib/checkout/submit.ts#L909-L941)) never passes `qty_from_stock`/`qty_to_make`/`fulfilment_type`, so those columns are **not populated at customer-checkout submit time**. The correct, in-memory, always-available stock-draw signal is **`input.lines[].fulfilment_type === 'stocked'`** (the PDP order-mode toggle, see [submit.ts:54](../../../lib/checkout/submit.ts#L54) and its use for MOQ exemption at [submit.ts:400](../../../lib/checkout/submit.ts#L400)). This plan keys eligibility on that. Same intent as the spec (skip any stock-draw order), correct mechanism. Absent `fulfilment_type` (legacy carts) is treated as `made_to_order` (does not draw stock) — safe because the feature ships deploy-dark and all live carts carry the flag by the time `XERO_ENABLED` is switched on.

Everything else follows the approved spec: `docs/superpowers/specs/2026-07-02-xero-draft-invoices-on-order-design.md`.

## File structure

**Create:**
- `supabase/migrations/20260702120000_xero_invoice_columns.sql` — DDL: `organizations.xero_contact_id`, `orders.xero_invoice_id|xero_invoice_number|xero_invoice_status`.
- `lib/xero/config.ts` — env-derived config + `isXeroEnabled()`.
- `lib/xero/client.ts` — `getXeroToken()` (client_credentials, module-cached) + `xeroFetch()`.
- `lib/xero/eligibility.ts` — pure `evaluateXeroEligibility()`.
- `lib/xero/draft-invoice.ts` — pure `buildDraftInvoicePayload()` + `buildLineFromQuoteItem()`, `resolveXeroContactId()`, orchestrator `createDraftInvoiceForOrder()`.
- `lib/monday/updates.ts` — `postItemUpdate()` (manual-review note on the Monday card).
- Tests: `lib/xero/__tests__/{config,client,eligibility,build-payload,resolve-contact,create-draft}.test.ts`, `lib/monday/__tests__/updates.test.ts`.

**Modify:**
- `lib/audit/actions.ts` — three new action constants.
- `lib/checkout/submit.ts` — insert best-effort step 5c + two imports.

**Responsibilities (one job each):** `config` = env → typed config. `client` = auth + HTTP only. `eligibility` = the pure yes/no/why decision. `draft-invoice` = build the Xero payload + resolve the contact + orchestrate one order's draft. `updates` = one Monday mutation. The orchestrator is the only file that touches both the DB and Xero.

---

### Task 1: Migration — Xero columns

**Files:**
- Create: `supabase/migrations/20260702120000_xero_invoice_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Xero draft-invoice integration (Initiative 1).
-- organizations: cache the resolved Xero ContactID so we never re-resolve per order.
-- orders: record the draft's Xero ids + a lifecycle status for the manual-review flag.

alter table public.organizations
  add column if not exists xero_contact_id text;

alter table public.orders
  add column if not exists xero_invoice_id text,
  add column if not exists xero_invoice_number text,
  add column if not exists xero_invoice_status text;

-- Allowed statuses: drafted (auto-created in Xero), manual_review (flagged for
-- Charlotte), skipped (deliberately not drafted — e.g. test org). NULL = not yet
-- evaluated / feature was off at submit.
alter table public.orders
  drop constraint if exists orders_xero_invoice_status_check;
alter table public.orders
  add constraint orders_xero_invoice_status_check
  check (xero_invoice_status is null
         or xero_invoice_status in ('drafted', 'manual_review', 'skipped'));

comment on column public.organizations.xero_contact_id is
  'Cached Xero ContactID for this org (billing entity). Set on first draft.';
comment on column public.orders.xero_invoice_status is
  'drafted | manual_review | skipped | null. Source of truth for the manual-invoice flag.';
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name `20260702120000_xero_invoice_columns`, the SQL above), the same way portal migrations are applied in this project. (Do NOT run a local `supabase db push` — this repo applies to prod via MCP.)

- [ ] **Step 3: Verify the columns exist**

Run this via the Supabase MCP `execute_sql` tool:

```sql
select table_name, column_name, data_type
from information_schema.columns
where (table_name = 'organizations' and column_name = 'xero_contact_id')
   or (table_name = 'orders' and column_name in
        ('xero_invoice_id','xero_invoice_number','xero_invoice_status'))
order by table_name, column_name;
```

Expected: 4 rows, all `data_type = text`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260702120000_xero_invoice_columns.sql
git commit -m "feat(xero): add xero invoice columns to orders + organizations"
```

---

### Task 2: `lib/xero/config.ts` — env-derived config

**Files:**
- Create: `lib/xero/config.ts`
- Test: `lib/xero/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/xero/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isXeroEnabled, getXeroConfig } from '../config'

const SAVED = { ...process.env }
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('XERO_')) delete process.env[k]
})
afterEach(() => {
  process.env = { ...SAVED }
})

describe('isXeroEnabled', () => {
  it('is false when XERO_ENABLED is unset', () => {
    expect(isXeroEnabled()).toBe(false)
  })
  it.each(['1', 'true', 'TRUE', 'on', 'yes'])('is true for %s', (v) => {
    process.env.XERO_ENABLED = v
    expect(isXeroEnabled()).toBe(true)
  })
  it('is false for "0"/"false"/garbage', () => {
    for (const v of ['0', 'false', 'off', 'nope']) {
      process.env.XERO_ENABLED = v
      expect(isXeroEnabled()).toBe(false)
    }
  })
})

describe('getXeroConfig', () => {
  it('throws when client id/secret missing', () => {
    expect(() => getXeroConfig()).toThrow(/XERO_CLIENT_ID/)
  })
  it('applies defaults for optional vars', () => {
    process.env.XERO_CLIENT_ID = 'cid'
    process.env.XERO_CLIENT_SECRET = 'secret'
    const cfg = getXeroConfig()
    expect(cfg).toMatchObject({
      clientId: 'cid',
      clientSecret: 'secret',
      scopes: 'accounting.transactions accounting.contacts',
      tenantId: null,
      salesAccountCode: '200',
      taxType: 'OUTPUT2',
      currency: 'NZD',
      lineAmountTypes: 'Exclusive',
      brandingThemeId: null,
    })
  })
  it('reads overrides from env', () => {
    process.env.XERO_CLIENT_ID = 'cid'
    process.env.XERO_CLIENT_SECRET = 'secret'
    process.env.XERO_SALES_ACCOUNT_CODE = '260'
    process.env.XERO_TAX_TYPE = 'OUTPUT'
    process.env.XERO_LINE_AMOUNT_TYPES = 'Inclusive'
    process.env.XERO_TENANT_ID = 'tid'
    process.env.XERO_BRANDING_THEME_ID = 'bt-1'
    const cfg = getXeroConfig()
    expect(cfg).toMatchObject({
      salesAccountCode: '260', taxType: 'OUTPUT', lineAmountTypes: 'Inclusive',
      tenantId: 'tid', brandingThemeId: 'bt-1',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/xero/__tests__/config.test.ts`
Expected: FAIL — `Cannot find module '../config'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/xero/config.ts

export interface XeroConfig {
  clientId: string
  clientSecret: string
  scopes: string
  tenantId: string | null
  salesAccountCode: string
  taxType: string
  currency: string
  lineAmountTypes: string
  brandingThemeId: string | null
}

/** Deploy-dark rollout flag. Truthy = attempt Xero drafts. */
export function isXeroEnabled(): boolean {
  const v = (process.env.XERO_ENABLED ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

/** Read + validate Xero config from the environment. Throws if creds are absent. */
export function getXeroConfig(): XeroConfig {
  const clientId = process.env.XERO_CLIENT_ID ?? ''
  const clientSecret = process.env.XERO_CLIENT_SECRET ?? ''
  if (!clientId || !clientSecret) {
    throw new Error('XERO_CLIENT_ID / XERO_CLIENT_SECRET are not configured')
  }
  return {
    clientId,
    clientSecret,
    scopes: process.env.XERO_SCOPES ?? 'accounting.transactions accounting.contacts',
    tenantId: process.env.XERO_TENANT_ID || null,
    salesAccountCode: process.env.XERO_SALES_ACCOUNT_CODE ?? '200',
    taxType: process.env.XERO_TAX_TYPE ?? 'OUTPUT2',
    currency: process.env.XERO_CURRENCY ?? 'NZD',
    lineAmountTypes: process.env.XERO_LINE_AMOUNT_TYPES ?? 'Exclusive',
    brandingThemeId: process.env.XERO_BRANDING_THEME_ID || null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/xero/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/xero/config.ts lib/xero/__tests__/config.test.ts
git commit -m "feat(xero): env-derived config + enabled flag"
```

---

### Task 3: `lib/xero/client.ts` — token + HTTP client

**Files:**
- Create: `lib/xero/client.ts`
- Test: `lib/xero/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/xero/__tests__/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getXeroToken, xeroFetch, __resetXeroTokenCacheForTests } from '../client'

const SAVED = { ...process.env }
beforeEach(() => {
  __resetXeroTokenCacheForTests()
  vi.restoreAllMocks()
  process.env.XERO_CLIENT_ID = 'cid'
  process.env.XERO_CLIENT_SECRET = 'secret'
  delete process.env.XERO_TENANT_ID
})
afterEach(() => {
  process.env = { ...SAVED }
})

function mockFetchOnce(status: number, jsonBody: unknown, textBody = '') {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
    text: async () => textBody,
    headers: new Map(),
  })
}

describe('getXeroToken', () => {
  it('POSTs client_credentials and returns access_token', async () => {
    const f = mockFetchOnce(200, { access_token: 'tok-1', expires_in: 1800 })
    vi.stubGlobal('fetch', f)

    const token = await getXeroToken()
    expect(token).toBe('tok-1')

    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://identity.xero.com/connect/token')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Basic /)
    expect(init.body).toContain('grant_type=client_credentials')
  })

  it('caches the token across calls (no second network hit)', async () => {
    const f = mockFetchOnce(200, { access_token: 'tok-cache', expires_in: 1800 })
    vi.stubGlobal('fetch', f)
    await getXeroToken()
    await getXeroToken()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('throws on non-2xx token response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(401, {}, 'unauthorized_client'))
    await expect(getXeroToken()).rejects.toThrow(/Xero token HTTP 401/)
  })
})

describe('xeroFetch', () => {
  it('sends Bearer token, JSON accept, and Idempotency-Key when provided', async () => {
    const f = vi
      .fn()
      // 1st call: token
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 1800 }), text: async () => '', headers: new Map() })
      // 2nd call: the API request
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Invoices: [{ InvoiceID: 'inv-1' }] }), text: async () => '', headers: new Map() })
    vi.stubGlobal('fetch', f)

    const res = await xeroFetch<{ Invoices: Array<{ InvoiceID: string }> }>('/Invoices', {
      method: 'POST',
      idempotencyKey: 'order-1',
      body: JSON.stringify({ Invoices: [] }),
    })
    expect(res.Invoices[0].InvoiceID).toBe('inv-1')

    const [url, init] = f.mock.calls[1]
    expect(url).toBe('https://api.xero.com/api.xro/2.0/Invoices')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.headers.Accept).toBe('application/json')
    expect(init.headers['Idempotency-Key']).toBe('order-1')
  })

  it('throws with body text on non-2xx', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 1800 }), text: async () => '', headers: new Map() })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}), text: async () => 'ValidationException', headers: new Map() })
    vi.stubGlobal('fetch', f)
    await expect(xeroFetch('/Invoices', { method: 'POST' })).rejects.toThrow(/Xero API 400 on \/Invoices: ValidationException/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/xero/__tests__/client.test.ts`
Expected: FAIL — `Cannot find module '../client'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/xero/client.ts
import { getXeroConfig } from './config'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

interface CachedToken {
  accessToken: string
  expiresAt: number // epoch ms
}
let cached: CachedToken | null = null

/** Test-only: clear the module-scope token cache. */
export function __resetXeroTokenCacheForTests(): void {
  cached = null
}

/** Get a valid access token, refreshing when within 60s of expiry. */
export async function getXeroToken(): Promise<string> {
  const now = Date.now()
  if (cached && cached.expiresAt - 60_000 > now) return cached.accessToken

  const cfg = getXeroConfig()
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: cfg.scopes })

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Xero token HTTP ${res.status}: ${text}`)
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('Xero token response missing access_token')

  cached = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 1800) * 1000,
  }
  return cached.accessToken
}

export interface XeroFetchInit extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
  /** Sent as the Xero `Idempotency-Key` header on writes. */
  idempotencyKey?: string
}

/** Authenticated JSON fetch against the Xero Accounting API. Throws on non-2xx. */
export async function xeroFetch<T = unknown>(path: string, init: XeroFetchInit = {}): Promise<T> {
  const { idempotencyKey, headers: extraHeaders, ...rest } = init
  const cfg = getXeroConfig()
  const token = await getXeroToken()

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(cfg.tenantId ? { 'Xero-tenant-id': cfg.tenantId } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...(extraHeaders ?? {}),
  }

  const res = await fetch(`${XERO_API_BASE}${path}`, { ...rest, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Xero API ${res.status} on ${path}: ${text}`)
  }
  return (await res.json()) as T
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/xero/__tests__/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/xero/client.ts lib/xero/__tests__/client.test.ts
git commit -m "feat(xero): client_credentials token + xeroFetch client"
```

---

### Task 4: `lib/xero/eligibility.ts` — pure predicate

**Files:**
- Create: `lib/xero/eligibility.ts`
- Test: `lib/xero/__tests__/eligibility.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/xero/__tests__/eligibility.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateXeroEligibility, type XeroEligibilityInput } from '../eligibility'

const base: XeroEligibilityInput = {
  xeroEnabled: true,
  existingInvoiceId: null,
  isTestOrg: false,
  paymentTerms: 'net20',
  drawsStock: false,
}

describe('evaluateXeroEligibility', () => {
  it('drafts a clean net-terms pure-production order', () => {
    expect(evaluateXeroEligibility(base)).toEqual({ eligible: true, reason: 'ok' })
  })

  it('drafts an add-to-inventory production run (no stock draw, net terms)', () => {
    // intent==="inventory" has no stocked lines → drawsStock false → drafted.
    expect(evaluateXeroEligibility({ ...base, drawsStock: false })).toEqual({ eligible: true, reason: 'ok' })
  })

  it('skips when the feature flag is off (checked first, fully inert)', () => {
    expect(evaluateXeroEligibility({ ...base, xeroEnabled: false, drawsStock: true, isTestOrg: true }))
      .toEqual({ eligible: false, reason: 'disabled' })
  })

  it('skips when already drafted (dedup)', () => {
    expect(evaluateXeroEligibility({ ...base, existingInvoiceId: 'inv-9' }))
      .toEqual({ eligible: false, reason: 'already_drafted' })
  })

  it('skips test orgs (keep the real ledger clean)', () => {
    expect(evaluateXeroEligibility({ ...base, isTestOrg: true }))
      .toEqual({ eligible: false, reason: 'test_org' })
  })

  it('flags prepay orgs (billed bespoke)', () => {
    expect(evaluateXeroEligibility({ ...base, paymentTerms: 'prepay' }))
      .toEqual({ eligible: false, reason: 'prepay_org' })
  })

  it('flags any stock-draw order (can not tell paid from unpaid stock in v1)', () => {
    expect(evaluateXeroEligibility({ ...base, drawsStock: true }))
      .toEqual({ eligible: false, reason: 'draws_stock' })
  })

  it('precedence: disabled > already_drafted > test_org > prepay_org > draws_stock', () => {
    expect(evaluateXeroEligibility({
      xeroEnabled: true, existingInvoiceId: 'inv', isTestOrg: true, paymentTerms: 'prepay', drawsStock: true,
    })).toEqual({ eligible: false, reason: 'already_drafted' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/xero/__tests__/eligibility.test.ts`
Expected: FAIL — `Cannot find module '../eligibility'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/xero/eligibility.ts

export type XeroIneligibleReason =
  | 'disabled'
  | 'already_drafted'
  | 'test_org'
  | 'prepay_org'
  | 'draws_stock'
export type XeroEligibilityReason = 'ok' | XeroIneligibleReason

export interface XeroEligibilityInput {
  /** isXeroEnabled() result. */
  xeroEnabled: boolean
  /** orders.xero_invoice_id — non-null means a draft already exists. */
  existingInvoiceId: string | null
  /** organizations.is_test. */
  isTestOrg: boolean
  /** 'prepay' | 'net20' | 'net30' | null. */
  paymentTerms: string | null
  /** True if ANY order line draws from existing stock. */
  drawsStock: boolean
}

export interface XeroEligibility {
  eligible: boolean
  reason: XeroEligibilityReason
}

/**
 * Draft a Xero invoice iff ALL hold: feature on, not already drafted, not a test
 * org, not a prepay org, and no line draws stock. Order of checks defines
 * precedence (see test). draws_stock/prepay_org → the caller flags manual_review;
 * disabled/already_drafted/test_org → skipped.
 */
export function evaluateXeroEligibility(input: XeroEligibilityInput): XeroEligibility {
  if (!input.xeroEnabled) return { eligible: false, reason: 'disabled' }
  if (input.existingInvoiceId) return { eligible: false, reason: 'already_drafted' }
  if (input.isTestOrg) return { eligible: false, reason: 'test_org' }
  if (input.paymentTerms === 'prepay') return { eligible: false, reason: 'prepay_org' }
  if (input.drawsStock) return { eligible: false, reason: 'draws_stock' }
  return { eligible: true, reason: 'ok' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/xero/__tests__/eligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/xero/eligibility.ts lib/xero/__tests__/eligibility.test.ts
git commit -m "feat(xero): pure eligibility predicate"
```

---

### Task 5: `draft-invoice.ts` — pure payload + line builders

**Files:**
- Create: `lib/xero/draft-invoice.ts`
- Test: `lib/xero/__tests__/build-payload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/xero/__tests__/build-payload.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildDraftInvoicePayload,
  buildLineFromQuoteItem,
  dueDateFor,
  type BuildPayloadArgs,
  type QuoteItemForXero,
} from '../draft-invoice'

const baseArgs: BuildPayloadArgs = {
  contactId: 'contact-1',
  orderRef: 'ORD-2026-0042',
  today: '2026-07-02',
  paymentTerms: 'net20',
  currency: 'NZD',
  accountCode: '200',
  taxType: 'OUTPUT2',
  lineAmountTypes: 'Exclusive',
  brandingThemeId: null,
  lines: [
    { description: 'Basic Tee — Black / M (Logo Front)', quantity: 10, unitAmount: 12.5 },
    { description: 'Cap — OS', quantity: 20, unitAmount: 8 },
  ],
}

describe('dueDateFor', () => {
  it('adds 20 days for net20', () => expect(dueDateFor('net20', '2026-07-02')).toBe('2026-07-22'))
  it('adds 30 days for net30 (crossing a month)', () => expect(dueDateFor('net30', '2026-07-02')).toBe('2026-08-01'))
  it('returns undefined for prepay/null/unknown', () => {
    expect(dueDateFor('prepay', '2026-07-02')).toBeUndefined()
    expect(dueDateFor(null, '2026-07-02')).toBeUndefined()
    expect(dueDateFor('weird', '2026-07-02')).toBeUndefined()
  })
})

describe('buildDraftInvoicePayload', () => {
  it('builds an ACCREC DRAFT with GST-exclusive lines', () => {
    const p = buildDraftInvoicePayload(baseArgs)
    expect(p.Type).toBe('ACCREC')
    expect(p.Status).toBe('DRAFT')
    expect(p.Contact).toEqual({ ContactID: 'contact-1' })
    expect(p.LineAmountTypes).toBe('Exclusive')
    expect(p.Reference).toBe('ORD-2026-0042')
    expect(p.Date).toBe('2026-07-02')
    expect(p.DueDate).toBe('2026-07-22')
    expect(p.CurrencyCode).toBe('NZD')
    expect(p.LineItems).toEqual([
      { Description: 'Basic Tee — Black / M (Logo Front)', Quantity: 10, UnitAmount: 12.5, AccountCode: '200', TaxType: 'OUTPUT2' },
      { Description: 'Cap — OS', Quantity: 20, UnitAmount: 8, AccountCode: '200', TaxType: 'OUTPUT2' },
    ])
  })

  it('omits DueDate when payment terms give none, and omits branding when unset', () => {
    const p = buildDraftInvoicePayload({ ...baseArgs, paymentTerms: null })
    expect('DueDate' in p).toBe(false)
    expect('BrandingThemeID' in p).toBe(false)
  })

  it('includes BrandingThemeID when set', () => {
    const p = buildDraftInvoicePayload({ ...baseArgs, brandingThemeId: 'bt-9' })
    expect(p.BrandingThemeID).toBe('bt-9')
  })
})

describe('buildLineFromQuoteItem', () => {
  const row: QuoteItemForXero = {
    product_name: 'Basic Tee',
    quantity: 10,
    unit_price: 12.5,
    size_label: 'M',
    decorations: [{ name: 'Logo Front' }],
    product_variants: { product_color_swatches: { label: 'Black' } },
  }

  it('composes product + variant + design description', () => {
    expect(buildLineFromQuoteItem(row)).toEqual({
      description: 'Basic Tee — Black / M (Logo Front)',
      quantity: 10,
      unitAmount: 12.5,
    })
  })

  it('handles array-shaped swatch embeds and missing decoration', () => {
    const r: QuoteItemForXero = {
      ...row,
      decorations: null,
      product_variants: { product_color_swatches: [{ label: 'Navy' }] },
    }
    expect(buildLineFromQuoteItem(r)).toEqual({
      description: 'Basic Tee — Navy / M',
      quantity: 10,
      unitAmount: 12.5,
    })
  })

  it('degrades to product name only when no variant/decoration', () => {
    const r: QuoteItemForXero = {
      product_name: 'Sticker Pack', quantity: 5, unit_price: 3,
      size_label: null, decorations: [], product_variants: null,
    }
    expect(buildLineFromQuoteItem(r)).toEqual({ description: 'Sticker Pack', quantity: 5, unitAmount: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/xero/__tests__/build-payload.test.ts`
Expected: FAIL — `Cannot find module '../draft-invoice'`.

- [ ] **Step 3: Write the implementation (pure part of the file)**

```ts
// lib/xero/draft-invoice.ts

export interface XeroInvoiceLineInput {
  description: string
  quantity: number
  unitAmount: number
}

export interface BuildPayloadArgs {
  contactId: string
  orderRef: string
  today: string // 'YYYY-MM-DD'
  paymentTerms: string | null
  currency: string
  accountCode: string
  taxType: string
  lineAmountTypes: string
  brandingThemeId: string | null
  lines: XeroInvoiceLineInput[]
}

interface XeroLineItem {
  Description: string
  Quantity: number
  UnitAmount: number
  AccountCode: string
  TaxType: string
}

export interface XeroInvoicePayload {
  Type: 'ACCREC'
  Status: 'DRAFT'
  Contact: { ContactID: string }
  LineAmountTypes: string
  Reference: string
  Date: string
  DueDate?: string
  CurrencyCode: string
  BrandingThemeID?: string
  LineItems: XeroLineItem[]
}

/** Add whole days to a 'YYYY-MM-DD' date in UTC (deterministic, tz-safe). */
export function addDaysUTC(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** DueDate from payment terms. net20→+20d, net30→+30d, else none. */
export function dueDateFor(paymentTerms: string | null, today: string): string | undefined {
  if (paymentTerms === 'net20') return addDaysUTC(today, 20)
  if (paymentTerms === 'net30') return addDaysUTC(today, 30)
  return undefined
}

/** Build the Xero ACCREC DRAFT invoice object (one entry of a POST /Invoices batch). */
export function buildDraftInvoicePayload(args: BuildPayloadArgs): XeroInvoicePayload {
  const dueDate = dueDateFor(args.paymentTerms, args.today)
  const payload: XeroInvoicePayload = {
    Type: 'ACCREC',
    Status: 'DRAFT',
    Contact: { ContactID: args.contactId },
    LineAmountTypes: args.lineAmountTypes,
    Reference: args.orderRef,
    Date: args.today,
    CurrencyCode: args.currency,
    LineItems: args.lines.map((l) => ({
      Description: l.description,
      Quantity: l.quantity,
      UnitAmount: l.unitAmount,
      AccountCode: args.accountCode,
      TaxType: args.taxType,
    })),
  }
  if (dueDate) payload.DueDate = dueDate
  if (args.brandingThemeId) payload.BrandingThemeID = args.brandingThemeId
  return payload
}

// --- quote_items → invoice line ------------------------------------------------

type SwatchEmbed = { label: string | null } | { label: string | null }[] | null

export interface QuoteItemForXero {
  product_name: string
  quantity: number
  unit_price: number | string
  size_label: string | null
  decorations: Array<{ name?: string }> | null
  product_variants: { product_color_swatches: SwatchEmbed } | null
}

function firstOrSelf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * Compose one Xero invoice line from a persisted quote_item. unit_price already
 * includes any folded decoration cost (submit.ts folds it before the RPC), so we
 * bill it as-is. Description mirrors the Monday subitem label style.
 */
export function buildLineFromQuoteItem(row: QuoteItemForXero): XeroInvoiceLineInput {
  const swatch = firstOrSelf(row.product_variants?.product_color_swatches)
  const variantBits = [swatch?.label, row.size_label].filter(Boolean).join(' / ')
  const design = row.decorations?.[0]?.name
  const description = [
    row.product_name,
    variantBits ? `— ${variantBits}` : '',
    design ? `(${design})` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return { description, quantity: Number(row.quantity), unitAmount: Number(row.unit_price) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/xero/__tests__/build-payload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/xero/draft-invoice.ts lib/xero/__tests__/build-payload.test.ts
git commit -m "feat(xero): pure invoice-payload + line builders"
```

---

### Task 6: `resolveXeroContactId` — contact resolution

**Files:**
- Modify: `lib/xero/draft-invoice.ts` (append)
- Test: `lib/xero/__tests__/resolve-contact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/xero/__tests__/resolve-contact.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../client', () => ({ xeroFetch: vi.fn() }))
import { xeroFetch } from '../client'
import { resolveXeroContactId } from '../draft-invoice'

const mockFetch = vi.mocked(xeroFetch)
beforeEach(() => vi.resetAllMocks())

describe('resolveXeroContactId', () => {
  it('uses the cached contact id without any API call', async () => {
    const r = await resolveXeroContactId({ cachedContactId: 'cached-1', orgName: 'Acme', email: null })
    expect(r).toEqual({ contactId: 'cached-1', created: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('uses a single name match', async () => {
    mockFetch.mockResolvedValueOnce({ Contacts: [{ ContactID: 'found-1' }] })
    const r = await resolveXeroContactId({ cachedContactId: null, orgName: 'Acme', email: null })
    expect(r).toEqual({ contactId: 'found-1', created: false })
    expect(mockFetch.mock.calls[0][0]).toContain('/Contacts?where=')
  })

  it('creates a contact when none matches', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [] }) // name lookup: none
      .mockResolvedValueOnce({ Contacts: [{ ContactID: 'new-1' }] }) // create
    const r = await resolveXeroContactId({ cachedContactId: null, orgName: 'Acme', email: 'ap@acme.test' })
    expect(r).toEqual({ contactId: 'new-1', created: true })
    const [, init] = mockFetch.mock.calls[1]
    expect(init.method).toBe('POST')
    expect(init.body).toContain('"Name":"Acme"')
    expect(init.body).toContain('"EmailAddress":"ap@acme.test"')
  })

  it('recovers from a unique-name collision by re-querying', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [] }) // name lookup: none (race)
      .mockRejectedValueOnce(new Error('Xero API 400 on /Contacts: contact name must be unique'))
      .mockResolvedValueOnce({ Contacts: [{ ContactID: 'raced-1' }] }) // re-query wins
    const r = await resolveXeroContactId({ cachedContactId: null, orgName: 'Acme', email: null })
    expect(r).toEqual({ contactId: 'raced-1', created: false })
  })

  it('rethrows when create fails and re-query still finds nothing', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [] })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ Contacts: [] })
    await expect(resolveXeroContactId({ cachedContactId: null, orgName: 'Acme', email: null })).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/xero/__tests__/resolve-contact.test.ts`
Expected: FAIL — `resolveXeroContactId` is not exported.

- [ ] **Step 3: Append the implementation to `lib/xero/draft-invoice.ts`**

Add this import at the TOP of `lib/xero/draft-invoice.ts` (above the existing code):

```ts
import { xeroFetch } from './client'
```

Then append at the END of the file:

```ts
// --- contact resolution --------------------------------------------------------

interface XeroContactsResponse {
  Contacts?: Array<{ ContactID: string }>
}

export interface ResolveContactArgs {
  /** organizations.xero_contact_id, if already cached. */
  cachedContactId: string | null
  orgName: string
  email: string | null
}

export interface ResolvedContact {
  contactId: string
  /** True when we POSTed a brand-new contact (caller should cache it). */
  created: boolean
}

function contactNameWhere(orgName: string): string {
  // Xero `where` uses double-quoted string literals; escape embedded quotes.
  const escaped = orgName.replace(/"/g, '\\"')
  return `/Contacts?where=${encodeURIComponent(`Name=="${escaped}"`)}`
}

/**
 * Resolve the org's Xero ContactID: cache → single name match → create. Handles
 * Xero's unique-name-on-create by re-querying (covers a first-order race between
 * two checkouts for a brand-new org).
 */
export async function resolveXeroContactId(args: ResolveContactArgs): Promise<ResolvedContact> {
  if (args.cachedContactId) return { contactId: args.cachedContactId, created: false }

  const where = contactNameWhere(args.orgName)
  const found = await xeroFetch<XeroContactsResponse>(where)
  if (found.Contacts && found.Contacts.length === 1) {
    return { contactId: found.Contacts[0].ContactID, created: false }
  }

  try {
    const created = await xeroFetch<XeroContactsResponse>('/Contacts', {
      method: 'POST',
      body: JSON.stringify({
        Contacts: [{ Name: args.orgName, ...(args.email ? { EmailAddress: args.email } : {}) }],
      }),
    })
    const id = created.Contacts?.[0]?.ContactID
    if (!id) throw new Error('Xero contact create returned no ContactID')
    return { contactId: id, created: true }
  } catch (e) {
    // Unique-name collision (race or pre-existing dup) — re-query and reuse.
    const retry = await xeroFetch<XeroContactsResponse>(where)
    if (retry.Contacts && retry.Contacts.length >= 1) {
      return { contactId: retry.Contacts[0].ContactID, created: false }
    }
    throw e
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/xero/__tests__/resolve-contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/xero/draft-invoice.ts lib/xero/__tests__/resolve-contact.test.ts
git commit -m "feat(xero): resolve org contact (cache/match/create + collision)"
```

---

### Task 7: `createDraftInvoiceForOrder` — orchestrator

**Files:**
- Modify: `lib/audit/actions.ts` (add 3 constants — do this first so the import resolves)
- Modify: `lib/xero/draft-invoice.ts` (append orchestrator)
- Test: `lib/xero/__tests__/create-draft.test.ts`

- [ ] **Step 1: Add the audit actions**

In `lib/audit/actions.ts`, add these three entries to the `AUDIT_ACTIONS` object (after `ORDER_JOB_TRACKER_MONDAY_LINK_FAILED`):

```ts
  ORDER_XERO_DRAFTED: 'order.xero_drafted',
  ORDER_XERO_MANUAL_REVIEW: 'order.xero_manual_review',
  ORDER_XERO_DRAFT_FAILED: 'order.xero_draft_failed',
```

- [ ] **Step 2: Write the failing test**

```ts
// lib/xero/__tests__/create-draft.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({ xeroFetch: vi.fn() }))
vi.mock('@/lib/audit/recordEvent', () => ({ recordAuditEvent: vi.fn() }))

import { xeroFetch } from '../client'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { createDraftInvoiceForOrder, type CreateDraftInvoiceArgs } from '../draft-invoice'

const mockFetch = vi.mocked(xeroFetch)
const mockAudit = vi.mocked(recordAuditEvent)

/** Minimal chainable Supabase stub covering exactly the calls the orchestrator makes. */
function fakeAdmin(opts: { cachedContactId: string | null; quoteItems: unknown[] }) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const from = (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: table === 'organizations' ? { xero_contact_id: opts.cachedContactId } : null,
          error: null,
        }),
        // `await admin.from('quote_items').select().eq()` resolves here:
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: table === 'quote_items' ? opts.quoteItems : null, error: null }),
      }),
    }),
    update: (payload: Record<string, unknown>) => {
      updates.push({ table, payload })
      return { eq: async () => ({ error: null }) }
    },
  })
  return { admin: { from } as unknown as SupabaseClient, updates }
}

const args: CreateDraftInvoiceArgs = {
  orderId: 'order-1',
  orderRef: 'ORD-2026-0042',
  quoteId: 'quote-1',
  organizationId: 'org-1',
  organizationName: 'Acme Co',
  actorUserId: 'user-1',
  ordererEmail: 'buyer@acme.test',
  paymentTerms: 'net20',
  isTestOrg: false,
  drawsStock: false,
  existingInvoiceId: null,
  today: '2026-07-02',
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.XERO_ENABLED = 'true'
  process.env.XERO_CLIENT_ID = 'cid'
  process.env.XERO_CLIENT_SECRET = 'secret'
})

describe('createDraftInvoiceForOrder — eligible', () => {
  it('resolves contact, POSTs a draft, persists ids, audits drafted', async () => {
    mockFetch
      .mockResolvedValueOnce({ Contacts: [{ ContactID: 'c-1' }] }) // name match
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'inv-1', InvoiceNumber: 'INV-0001' }] }) // create
    const { admin, updates } = fakeAdmin({
      cachedContactId: null,
      quoteItems: [{ product_name: 'Tee', quantity: 10, unit_price: 12.5, size_label: 'M', decorations: [{ name: 'Logo' }], product_variants: { product_color_swatches: { label: 'Black' } } }],
    })

    const res = await createDraftInvoiceForOrder(admin, args)

    expect(res).toEqual({ status: 'drafted', reason: 'ok', invoiceId: 'inv-1', invoiceNumber: 'INV-0001' })
    // POST /Invoices carries the order id as the Idempotency-Key
    const invoiceCall = mockFetch.mock.calls.find((c) => c[0] === '/Invoices')
    expect(invoiceCall?.[1]).toMatchObject({ method: 'POST', idempotencyKey: 'order-1' })
    // org cache written + orders row stamped
    expect(updates).toContainEqual({ table: 'organizations', payload: { xero_contact_id: 'c-1' } })
    expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_id: 'inv-1', xero_invoice_number: 'INV-0001', xero_invoice_status: 'drafted' } })
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.xero_drafted' }), admin)
  })
})

describe('createDraftInvoiceForOrder — ineligible', () => {
  it('flags manual_review on a stock-draw order (no Xero call)', async () => {
    const { admin, updates } = fakeAdmin({ cachedContactId: null, quoteItems: [] })
    const res = await createDraftInvoiceForOrder(admin, { ...args, drawsStock: true })
    expect(res).toEqual({ status: 'manual_review', reason: 'draws_stock' })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_status: 'manual_review' } })
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.xero_manual_review' }), admin)
  })

  it('skips (no write, no audit) when the flag is off', async () => {
    process.env.XERO_ENABLED = 'false'
    const { admin, updates } = fakeAdmin({ cachedContactId: null, quoteItems: [] })
    const res = await createDraftInvoiceForOrder(admin, args)
    expect(res).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(updates).toHaveLength(0)
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('records skipped status for a test org (no audit)', async () => {
    const { admin, updates } = fakeAdmin({ cachedContactId: null, quoteItems: [] })
    const res = await createDraftInvoiceForOrder(admin, { ...args, isTestOrg: true })
    expect(res).toEqual({ status: 'skipped', reason: 'test_org' })
    expect(updates).toContainEqual({ table: 'orders', payload: { xero_invoice_status: 'skipped' } })
    expect(mockAudit).not.toHaveBeenCalled()
  })
})

describe('createDraftInvoiceForOrder — Xero failure propagates', () => {
  it('throws when POST /Invoices fails (caller catches + audits failed)', async () => {
    // cachedContactId set → resolveXeroContactId short-circuits (no fetch), so the
    // ONLY xeroFetch call is POST /Invoices — mock it to reject.
    mockFetch.mockRejectedValueOnce(new Error('Xero API 400 on /Invoices: ValidationException'))
    const { admin } = fakeAdmin({ cachedContactId: 'c-1', quoteItems: [] })
    await expect(createDraftInvoiceForOrder(admin, args)).rejects.toThrow(/ValidationException/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/xero/__tests__/create-draft.test.ts`
Expected: FAIL — `createDraftInvoiceForOrder` is not exported.

- [ ] **Step 4: Append the orchestrator to `lib/xero/draft-invoice.ts`**

Add these imports at the TOP of `lib/xero/draft-invoice.ts` (alongside the `xeroFetch` import from Task 6):

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAuditEvent } from '@/lib/audit/recordEvent'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { getXeroConfig, isXeroEnabled } from './config'
import { evaluateXeroEligibility } from './eligibility'
```

Append at the END of the file:

```ts
// --- orchestrator --------------------------------------------------------------

interface XeroInvoicesResponse {
  Invoices?: Array<{ InvoiceID: string; InvoiceNumber?: string }>
}

export interface CreateDraftInvoiceArgs {
  orderId: string
  orderRef: string
  quoteId: string
  organizationId: string
  organizationName: string
  actorUserId: string | null
  ordererEmail: string | null
  paymentTerms: string | null // 'prepay' | 'net20' | 'net30' | null
  isTestOrg: boolean
  drawsStock: boolean
  existingInvoiceId: string | null
  today: string // 'YYYY-MM-DD'
}

export interface CreateDraftInvoiceResult {
  status: 'drafted' | 'manual_review' | 'skipped'
  reason: string
  invoiceId?: string
  invoiceNumber?: string
}

/**
 * Create one order's Xero DRAFT invoice, or flag it for manual review.
 * Best-effort contract: on a Xero/DB error it THROWS — the caller (submit.ts
 * step 5c) wraps this in try/catch and audits ORDER_XERO_DRAFT_FAILED. It never
 * rolls back the order.
 */
export async function createDraftInvoiceForOrder(
  admin: SupabaseClient,
  args: CreateDraftInvoiceArgs,
): Promise<CreateDraftInvoiceResult> {
  const elig = evaluateXeroEligibility({
    xeroEnabled: isXeroEnabled(),
    existingInvoiceId: args.existingInvoiceId,
    isTestOrg: args.isTestOrg,
    paymentTerms: args.paymentTerms,
    drawsStock: args.drawsStock,
  })

  if (!elig.eligible) {
    // prepay + stock-draw are billable-but-uncostable in v1 → Charlotte's queue.
    if (elig.reason === 'prepay_org' || elig.reason === 'draws_stock') {
      await admin.from('orders').update({ xero_invoice_status: 'manual_review' }).eq('id', args.orderId)
      await recordAuditEvent(
        {
          orgId: args.organizationId,
          actorUserId: args.actorUserId,
          action: AUDIT_ACTIONS.ORDER_XERO_MANUAL_REVIEW,
          targetType: 'order',
          targetId: args.orderId,
          metadata: { order_ref: args.orderRef, reason: elig.reason },
        },
        admin,
      )
      return { status: 'manual_review', reason: elig.reason }
    }
    // test_org → record a 'skipped' status (keeps the ledger clean, no nag).
    if (elig.reason === 'test_org') {
      await admin.from('orders').update({ xero_invoice_status: 'skipped' }).eq('id', args.orderId)
    }
    // 'disabled' / 'already_drafted' → fully inert (no write, no audit).
    return { status: 'skipped', reason: elig.reason }
  }

  const cfg = getXeroConfig()

  // Contact — read the cached id, resolve, and cache back if newly created.
  const { data: orgRow } = await admin
    .from('organizations')
    .select('xero_contact_id')
    .eq('id', args.organizationId)
    .maybeSingle()
  const cachedContactId = (orgRow as { xero_contact_id: string | null } | null)?.xero_contact_id ?? null
  const { contactId, created } = await resolveXeroContactId({
    cachedContactId,
    orgName: args.organizationName,
    email: args.ordererEmail,
  })
  if (created || !cachedContactId) {
    await admin.from('organizations').update({ xero_contact_id: contactId }).eq('id', args.organizationId)
  }

  // Lines — read the persisted quote_items (canonical, decoration already folded).
  const { data: itemRows } = await admin
    .from('quote_items')
    .select(
      `product_name, quantity, unit_price, size_label, decorations,
       product_variants ( product_color_swatches(label) )`,
    )
    .eq('quote_id', args.quoteId)
  const lines = ((itemRows ?? []) as unknown as QuoteItemForXero[]).map(buildLineFromQuoteItem)

  const payload = buildDraftInvoicePayload({
    contactId,
    orderRef: args.orderRef,
    today: args.today,
    paymentTerms: args.paymentTerms,
    currency: cfg.currency,
    accountCode: cfg.salesAccountCode,
    taxType: cfg.taxType,
    lineAmountTypes: cfg.lineAmountTypes,
    brandingThemeId: cfg.brandingThemeId,
    lines,
  })

  // Idempotency-Key (order id) closes the write→persist crash gap: a retry with
  // the same key returns the already-created draft instead of a duplicate.
  const res = await xeroFetch<XeroInvoicesResponse>('/Invoices', {
    method: 'POST',
    idempotencyKey: args.orderId,
    body: JSON.stringify({ Invoices: [payload] }),
  })
  const inv = res.Invoices?.[0]
  if (!inv?.InvoiceID) throw new Error('Xero invoice create returned no InvoiceID')

  await admin
    .from('orders')
    .update({
      xero_invoice_id: inv.InvoiceID,
      xero_invoice_number: inv.InvoiceNumber ?? null,
      xero_invoice_status: 'drafted',
    })
    .eq('id', args.orderId)

  await recordAuditEvent(
    {
      orgId: args.organizationId,
      actorUserId: args.actorUserId,
      action: AUDIT_ACTIONS.ORDER_XERO_DRAFTED,
      targetType: 'order',
      targetId: args.orderId,
      metadata: { order_ref: args.orderRef, xero_invoice_id: inv.InvoiceID, xero_invoice_number: inv.InvoiceNumber ?? null },
    },
    admin,
  )

  return { status: 'drafted', reason: 'ok', invoiceId: inv.InvoiceID, invoiceNumber: inv.InvoiceNumber }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/xero/__tests__/create-draft.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/audit/actions.ts lib/xero/draft-invoice.ts lib/xero/__tests__/create-draft.test.ts
git commit -m "feat(xero): draft-invoice orchestrator + audit actions"
```

---

### Task 8: `lib/monday/updates.ts` — manual-review note

**Files:**
- Create: `lib/monday/updates.ts`
- Test: `lib/monday/__tests__/updates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/monday/__tests__/updates.test.ts`
Expected: FAIL — `Cannot find module '../updates'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/monday/updates.ts
import { mondayApiCall } from './client'

/**
 * Post an update (comment) on a Monday item. Used to surface a manual-invoice
 * flag on an order's Production card. Throws on API error — callers wrap it
 * best-effort.
 */
export async function postItemUpdate(itemId: string, body: string): Promise<string | null> {
  const query = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) { id }
    }
  `
  const data = await mondayApiCall<{ create_update: { id: string } | null }>(query, { itemId, body })
  return data.create_update?.id ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/monday/__tests__/updates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/monday/updates.ts lib/monday/__tests__/updates.test.ts
git commit -m "feat(monday): postItemUpdate for manual-review notes"
```

---

### Task 9: Wire step 5c into `submitCustomerOrder`

**Files:**
- Modify: `lib/checkout/submit.ts` (2 imports + 1 new block)

- [ ] **Step 1: Add the imports**

In `lib/checkout/submit.ts`, after the existing import block (the last import is `import { getOpenPeriodForOrg, getPreOrderItemIds } from '@/lib/pricing/period-brackets'` at line 14), add:

```ts
import { createDraftInvoiceForOrder } from '@/lib/xero/draft-invoice'
import { postItemUpdate } from '@/lib/monday/updates'
```

- [ ] **Step 2: Insert the best-effort Xero block**

In `lib/checkout/submit.ts`, find the end of the proof-shell `try/catch` block (the `}` closing the `catch (auditErr)` inner block, immediately before the comment `// Fetch the email payload from quotes/quote_items` at line ~1401). Insert this new block BETWEEN that closing `}` and the `// Fetch the email payload` comment:

```ts
  // 5c. Best-effort Xero DRAFT invoice for fully-billable orders. Mirrors the
  //     Monday/email side-effects: never throws, audits on failure. Ineligible
  //     orders (test org, prepay org, or ANY stock-draw line) are flagged
  //     xero_invoice_status='manual_review' for Charlotte instead of drafted.
  //     Stock-draw is read from the cart lines' fulfilment_type — the submit RPC
  //     payload does not persist per-line stock qty (see the p_lines map above).
  try {
    const drawsStock = input.lines.some((l) => l.fulfilment_type === 'stocked')
    const { data: xeroOrgRow } = await admin
      .from('organizations')
      .select('is_test')
      .eq('id', input.context.organizationId)
      .maybeSingle()
    const xeroIsTestOrg = Boolean((xeroOrgRow as { is_test?: boolean } | null)?.is_test)

    const xeroResult = await createDraftInvoiceForOrder(admin, {
      orderId: order_id,
      orderRef: order_ref,
      quoteId: quote_id,
      organizationId: input.context.organizationId,
      organizationName: input.context.organizationName,
      actorUserId: input.context.userId,
      ordererEmail: input.context.email ?? null,
      paymentTerms: input.context.paymentTerms ?? null,
      isTestOrg: xeroIsTestOrg,
      drawsStock,
      existingInvoiceId: null, // fresh order — no prior draft
      today: new Date().toISOString().slice(0, 10),
    })

    // Surface a manual-invoice flag where Charlotte works (best-effort within
    // this already-best-effort block). The orchestrator already set the DB
    // status + audit; this is just the human-visible nudge on the Monday card.
    if (xeroResult.status === 'manual_review' && mondayItemId) {
      try {
        await postItemUpdate(
          mondayItemId,
          `⚠️ Manual invoice required — this order was not auto-drafted in Xero ` +
            `(reason: ${xeroResult.reason}). Please raise the invoice manually.`,
        )
      } catch (noteErr) {
        console.error('[Checkout] Xero manual-review Monday note failed (swallowed)', {
          orderId: order_id,
          err: noteErr instanceof Error ? noteErr.message : String(noteErr),
        })
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[Checkout] Xero draft invoice failed (swallowed)', { orderId: order_id, err: message })
    try {
      await recordAuditEvent(
        {
          orgId: input.context.organizationId,
          actorUserId: input.context.userId,
          action: AUDIT_ACTIONS.ORDER_XERO_DRAFT_FAILED,
          targetType: 'order',
          targetId: order_id,
          metadata: { order_ref, quote_id, error: message },
        },
        admin,
      )
    } catch {
      // truly best-effort
    }
  }

```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no new errors. (This project's baseline may carry pre-existing catalogue test-type errors; confirm no NEW errors reference `lib/xero/**`, `lib/monday/updates.ts`, or the new `submit.ts` block.)

- [ ] **Step 4: Run the full xero + monday test suite**

Run: `npx vitest run lib/xero lib/monday`
Expected: PASS — all new tests plus the existing Monday tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/checkout/submit.ts
git commit -m "feat(xero): draft invoice on order placement (best-effort step 5c)"
```

---

### Task 10: Full gate + rollout readiness

**Files:** none (verification + docs only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS for all `lib/xero/**` and `lib/monday/**` tests. Any failures elsewhere should match the project's known pre-existing baseline (confirm none touch the new files).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds. `Buffer` (used in `client.ts`) is a Node global available in the Next.js server runtime — `submitCustomerOrder` runs server-side, so no bundling issue.

- [ ] **Step 3: Confirm the deploy-dark posture**

Verify `isXeroEnabled()` returns false when `XERO_ENABLED` is unset, so shipping this code changes nothing until the flag is set. (Covered by `config.test.ts`; re-confirm no other code path calls Xero.)

- [ ] **Step 4: Record the rollout checklist in the plan handoff**

The code is inert until configured. Before flipping the flag (owner: accounts + Jon):
1. Set up the Xero **Custom Connection** (paid add-on); capture `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`.
2. Add Vercel env vars: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_SALES_ACCOUNT_CODE` (confirm revenue account, default `200`), `XERO_TAX_TYPE` (`OUTPUT2`), optional `XERO_BRANDING_THEME_ID`, `XERO_TENANT_ID` (only if the Custom Connection requires it). Leave `XERO_ENABLED` **off**.
3. **Confirm GST-exclusive storage** (spec open item): if portal `quote_items.unit_price` is stored GST-INCLUSIVE, set `XERO_LINE_AMOUNT_TYPES=Inclusive` — no code change needed.
4. Point the Custom Connection creds at a **Xero Demo Company** in a non-prod env, set `XERO_ENABLED=true`, and smoke:
   - A clean net-terms order → one DRAFT invoice, correct contact, GST line, total, `Reference=order_ref`, `orders.xero_invoice_id/number` persisted, audit `order.xero_drafted`.
   - A stock-draw order and a prepay-org order → **no draft**, `orders.xero_invoice_status='manual_review'`, audit `order.xero_manual_review`, ⚠️ note on the Monday card.
   - A test org (`organizations.is_test=true`) → no draft, status `skipped`.
5. Flip `XERO_ENABLED` on in prod; watch the first live orders (audit feed + the manual-review notes).

- [ ] **Step 5: Commit the plan (if edited during execution)**

```bash
git add docs/superpowers/plans/2026-07-02-xero-draft-invoices-initiative-1.md
git commit -m "docs: Xero draft-invoice Initiative 1 implementation plan"
```

---

## Out of scope (Initiative 2 — deferred, separate spec)

- Paid/unpaid inventory costing (lot-level balances + draw-down policy) so mixed-stock orders can be partially invoiced.
- Reorder-path convergence: routing tracker-reorders (`app/api/reorder`) and `variant_reorder_requests` through the priced checkout flow so they become invoiceable. **Until then those two paths are not auto-invoiced.** Cart-rebuild reorders ARE covered (they re-price through `submitCustomerOrder`).
- Consolidated/monthly sending (the "20th"): drafts are per-order; Charlotte consolidates and sends inside Xero.

## Self-review notes (author)

- **Spec coverage:** eligibility 5-conditions → Task 4; GST-exclusive + one-line-per-item + Reference + DueDate → Task 5; contact resolve + unique-name collision → Task 6; idempotency (Idempotency-Key) + persist ids + audit → Task 7; manual-review visibility (DB status + Monday note) → Tasks 7 & 9; data-model migration → Task 1; config/secrets → Task 2; testing & rollout → Task 10. The `qty_from_stock` open item is resolved via the fulfilment_type deviation (top of plan); the `payment_terms` open item is resolved (prepay|net20|net30).
- **Type consistency:** `evaluateXeroEligibility` reasons (`disabled|already_drafted|test_org|prepay_org|draws_stock|ok`) are the same strings consumed in Task 7's status mapping. `CreateDraftInvoiceArgs`/`Result`, `BuildPayloadArgs`, `QuoteItemForXero`, `ResolveContactArgs` names are used identically across tasks. `xeroFetch` init uses `idempotencyKey` in both client (Task 3) and orchestrator (Task 7).
- **No placeholders:** every code + test step is complete.
