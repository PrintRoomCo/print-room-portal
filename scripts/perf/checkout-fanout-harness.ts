/**
 * Phase-1 perf harness — measures the PostgREST round-trip fan-out of
 * submitCustomerOrder's validation/pricing phase on a large uniform order.
 *
 * READ-ONLY BY CONSTRUCTION:
 *  - Every line carries claimed_manual_decoration: -1, which is guaranteed to
 *    mismatch the server figure, so submitCustomerOrder throws
 *    DecorationDriftError at the end of the decoration loop — BEFORE the
 *    submit_b2b_order RPC. No order, quote, audit row, email, Monday item or
 *    Xero draft is ever created.
 *  - Belt-and-braces: the counting fetch wrapper hard-blocks submit_b2b_order,
 *    mark_inventory_received, and any non-GET request to a plain table.
 *
 * Usage:  npx tsx scripts/perf/checkout-fanout-harness.ts [lineCount]
 *         (default 40 lines × 3 decorations, mirroring a bulk uniform order)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { submitCustomerOrder, DecorationDriftError, type CheckoutInput } from '../../lib/checkout/submit'
import type { B2BCustomerContext } from '../../lib/checkout/server'

// ---------------------------------------------------------------- env
function loadEnvLocal(): Record<string, string> {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = loadEnvLocal()
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// ---------------------------------------------------------------- counter
interface CallRecord {
  seq: number
  tag: string
  method: string
  startMs: number
  endMs: number
  inFlightAtStart: number
}
const calls: CallRecord[] = []
let inFlight = 0
let seq = 0
const t0 = performance.now()

const BLOCKED_RPCS = ['submit_b2b_order', 'mark_inventory_received']

function tagFor(url: URL, method: string): string {
  const path = url.pathname
  const rpc = path.match(/\/rest\/v1\/rpc\/([^/?]+)/)
  if (rpc) return `rpc:${rpc[1]}`
  const table = path.match(/\/rest\/v1\/([^/?]+)/)
  if (table) return `${method.toLowerCase()}:${table[1]}`
  return `${method.toLowerCase()}:${path}`
}

const countingFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (init?.method ?? 'GET').toUpperCase()
  const rpcMatch = url.pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)
  if (rpcMatch && BLOCKED_RPCS.includes(rpcMatch[1])) {
    throw new Error(`HARNESS GUARD: blocked write RPC ${rpcMatch[1]} — the fixture should never reach this`)
  }
  if (!rpcMatch && url.pathname.startsWith('/rest/v1/') && method !== 'GET' && method !== 'HEAD') {
    throw new Error(`HARNESS GUARD: blocked ${method} ${url.pathname} — fan-out phase must be read-only`)
  }
  const rec: CallRecord = {
    seq: seq++,
    tag: tagFor(url, method),
    method,
    startMs: performance.now() - t0,
    endMs: 0,
    inFlightAtStart: inFlight,
  }
  inFlight++
  try {
    return await fetch(input as RequestInfo, init)
  } finally {
    inFlight--
    rec.endMs = performance.now() - t0
    calls.push(rec)
  }
}

// ---------------------------------------------------------------- fixture
const DEMO_ORG_ID = '2b8efaa2-95de-4be5-9c85-88e5f0f06835' // Print Room Demo (is_test)
const DEMO_MEMBERSHIP_ID = 'a94539b2-3a8d-4813-86ef-7a0217921292'
const DEMO_USER_ID = '9b517de3-9751-4884-8817-a8beee2e9dbc'

interface FixtureItem {
  catalogueItemId: string
  productId: string
  productName: string
  links: Array<{ linkId: string; decorationId: string; name: string; method: string; unitPrice: number }>
}

async function discoverFixture(): Promise<FixtureItem[]> {
  // Discovery uses a plain (uncounted) client — these calls are not part of checkout.
  const discovery = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } })
  const { data, error } = await discovery
    .from('b2b_catalogue_item_decorations')
    .select(`
      id, catalogue_item_id,
      b2b_catalogue_items!inner(id, source_product_id, is_active, price_mode, b2b_catalogues!inner(organization_id, is_active)),
      org_decorations!inner(id, name, decoration_method, unit_price, is_active)
    `)
    .eq('is_published', true)
    .eq('b2b_catalogue_items.is_active', true)
    .eq('b2b_catalogue_items.b2b_catalogues.organization_id', DEMO_ORG_ID)
    .eq('b2b_catalogue_items.b2b_catalogues.is_active', true)
  if (error) throw new Error(`fixture discovery failed: ${error.message}`)

  const productNames = new Map<string, string>()
  {
    const pids = Array.from(new Set((data ?? []).map((r: any) => r.b2b_catalogue_items.source_product_id)))
    const { data: prods } = await discovery.from('products').select('id, name').in('id', pids)
    for (const p of (prods ?? []) as Array<{ id: string; name: string }>) productNames.set(p.id, p.name)
  }

  const byItem = new Map<string, FixtureItem>()
  for (const r of (data ?? []) as any[]) {
    const itemId = r.catalogue_item_id as string
    const productId = r.b2b_catalogue_items.source_product_id as string
    const fi = byItem.get(itemId) ?? {
      catalogueItemId: itemId,
      productId,
      productName: productNames.get(productId) ?? 'Unknown product',
      links: [],
    }
    fi.links.push({
      linkId: r.id,
      decorationId: r.org_decorations.id,
      name: r.org_decorations.name,
      method: r.org_decorations.decoration_method,
      unitPrice: Number(r.org_decorations.unit_price),
    })
    byItem.set(itemId, fi)
  }
  const items = Array.from(byItem.values()).filter((i) => i.links.length >= 3)
  if (items.length === 0) throw new Error('no demo catalogue items with 3+ published decoration links')
  return items
}

function buildInput(items: FixtureItem[], lineCount: number): CheckoutInput {
  const context: B2BCustomerContext = {
    userId: DEMO_USER_ID,
    membershipId: DEMO_MEMBERSHIP_ID,
    role: 'org_admin', // skips buyer-scope guard; grants still resolve from the DB membership row
    email: 'jamie@theprint-room.co.nz', // safety: never reached (drift throws pre-RPC), but test inbox regardless
    fullName: 'Perf Harness',
    organizationId: DEMO_ORG_ID,
    organizationName: 'Print Room Demo',
    customerCode: 'DEMO',
    isTest: false,
    b2bAccountId: null,
    tierLevel: null,
    paymentTerms: 'net30',
    contractNotes: null,
    pricingMode: null,
    defaultDepositPercent: null,
    storeIds: [],
    defaultStoreId: null,
    branchStoreIds: [],
    tenantType: null,
    allowsMultiStoreOrdering: false,
    moqExempt: false,
    orderingPermission: 'both',
    isPreview: false,
  } as B2BCustomerContext

  const lines = Array.from({ length: lineCount }, (_, i) => {
    const item = items[i % items.length]
    return {
      product_id: item.productId,
      product_name: item.productName,
      variant_id: null,
      size_id: null,
      size_label: null,
      qty: 10,
      ship_to_store_id: null,
      cart_line_id: `perf-line-${i}`,
      catalogueItemId: item.catalogueItemId,
      // Guaranteed drift: the server recomputes the combined manual figure and
      // compares with zero tolerance; -1 can never match, so the run always
      // ends in DecorationDriftError before submit_b2b_order.
      claimed_manual_decoration: -1,
      decorations: item.links.slice(0, 3).map((l) => ({
        linkId: l.linkId,
        decorationId: l.decorationId,
        name: l.name,
        method: l.method,
        positionLabel: null,
        unitPrice: l.unitPrice,
        artworkUrl: null,
        snapshotUrl: null,
      })),
    }
  })

  return {
    context,
    idempotency_key: `perf-harness-${Date.now()}`,
    lines,
    custom_shipping_address: null,
    intent: 'customer',
  }
}

// ---------------------------------------------------------------- report
function report(lineCount: number, decosPerLine: number, wallMs: number, outcome: string) {
  const byTag = new Map<string, { n: number; totalMs: number; rtts: number[] }>()
  for (const c of calls) {
    const e = byTag.get(c.tag) ?? { n: 0, totalMs: 0, rtts: [] }
    e.n++
    e.totalMs += c.endMs - c.startMs
    e.rtts.push(c.endMs - c.startMs)
    byTag.set(c.tag, e)
  }
  const allRtts = calls.map((c) => c.endMs - c.startMs).sort((a, b) => a - b)
  const med = allRtts[Math.floor(allRtts.length / 2)] ?? 0
  const sequentialCalls = calls.filter((c) => c.inFlightAtStart === 0).length

  // The decoration loop phase: first link-select start → last manual-RPC end.
  const loopCalls = calls.filter(
    (c) => c.tag === 'get:b2b_catalogue_item_decorations' || c.tag === 'rpc:catalogue_item_decoration_price' || c.tag === 'rpc:effective_decoration_unit_price' || c.tag === 'get:b2b_accounts',
  )
  const loopStart = Math.min(...loopCalls.map((c) => c.startMs))
  const loopEnd = Math.max(...loopCalls.map((c) => c.endMs))

  console.log('\n================ CHECKOUT FAN-OUT BASELINE ================')
  console.log(`fixture:            ${lineCount} lines x ${decosPerLine} decorations (manual_final path)`)
  console.log(`outcome:            ${outcome}`)
  console.log(`total wall-clock:   ${wallMs.toFixed(0)} ms`)
  console.log(`total round-trips:  ${calls.length}`)
  console.log(`  started with 0 in flight (serialised): ${sequentialCalls}`)
  console.log(`median RTT/call:    ${med.toFixed(1)} ms  (min ${allRtts[0]?.toFixed(1)}, max ${allRtts[allRtts.length - 1]?.toFixed(1)})`)
  console.log(`decoration loop:    ${loopCalls.length} round-trips, ${(loopEnd - loopStart).toFixed(0)} ms wall-clock`)
  console.log('\nper endpoint:')
  const rows = Array.from(byTag.entries()).sort((a, b) => b[1].n - a[1].n)
  for (const [tag, e] of rows) {
    console.log(`  ${String(e.n).padStart(4)} x ${tag.padEnd(45)} sum ${e.totalMs.toFixed(0)} ms`)
  }
  console.log('\nJSON:', JSON.stringify({
    lineCount,
    decosPerLine,
    wallMs: Math.round(wallMs),
    roundTrips: calls.length,
    serialised: sequentialCalls,
    medianRttMs: Math.round(med * 10) / 10,
    loopRoundTrips: loopCalls.length,
    loopWallMs: Math.round(loopEnd - loopStart),
    byTag: Object.fromEntries(rows.map(([t, e]) => [t, e.n])),
  }))
}

// ---------------------------------------------------------------- main
async function main() {
  const lineCount = Number(process.argv[2] ?? 40)
  const items = await discoverFixture()
  console.log(`fixture items: ${items.map((i) => `${i.productName} (${i.links.length} links)`).join(', ')}`)
  const input = buildInput(items, lineCount)

  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false },
    global: { fetch: countingFetch },
  })

  const start = performance.now()
  let outcome: string
  try {
    const res = await submitCustomerOrder(admin, input)
    outcome = `!!! ORDER WAS CREATED (${JSON.stringify(res)}) — this must not happen; investigate immediately`
  } catch (e) {
    if (e instanceof DecorationDriftError) {
      outcome = `DecorationDriftError as expected (${e.drift.length} drift entries) — no writes performed`
    } else {
      outcome = `UNEXPECTED ${((e as Error).name)}: ${(e as Error).message}`
    }
  }
  const wallMs = performance.now() - start
  report(lineCount, 3, wallMs, outcome)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
