/**
 * Shared Supabase stub for the checkout fan-out tests
 * (submit.drift-characterization + submit.roundtrip-regression).
 *
 * Extends the pattern used across submit.*.test.ts with:
 *  - link rows for b2b_catalogue_item_decorations that honour .in('id', …)
 *    and .eq('is_published', true) filters (the batched select depends on it)
 *  - a b2b_accounts row for loadTierMultiplier
 *  - per-table from() call counts, so tests can assert round-trip budgets
 */
import { vi } from 'vitest'
import type { submitCustomerOrder } from '../submit'

type AnyRow = Record<string, unknown>

export interface RpcCallRecord {
  name: string
  args: AnyRow | undefined
}

export interface StubLink {
  id: string
  catalogueItemId: string
  sourceProductId: string
  isPublished?: boolean
  unitPriceOverride?: number | string | null
  snapshotUrl?: string | null
  orgDecoration: {
    id: string
    organizationId: string
    name: string
    method?: string
    unitPrice: number | string
    isActive?: boolean
    /**
     * Pooled decoration pricing: poolability is resolved SERVER-SIDE from
     * org_decorations (artwork present, method not 'custom'). Defaults to a real
     * artwork so decorations pool when a catalogue opts in; set null to model the
     * $0 placeholder that must never pool.
     */
    artworkId?: string | null
  }
}

export interface StubItem {
  id: string
  sourceProductId: string
  priceMode: 'manual_final' | 'computed'
  moqOverride?: number | null
  fulfilmentTypeOverride?: string | null
  /** Pooled decoration pricing — the owning catalogue and its opt-in flag. */
  catalogueId?: string
  poolingEnabled?: boolean
}

export interface StubProduct {
  id: string
  moq?: number | null
  fulfilmentType?: string | null
}

export interface StubConfig {
  items: StubItem[]
  products: StubProduct[]
  links: StubLink[]
  /** null → no b2b_accounts row (multiplier falls back to 1). */
  tier?: { tierDiscountOverride?: number | null; multiplier?: number } | null
  /** Return value for effective_decoration_unit_price, keyed by org_decoration_id. null → RPC returns null. */
  decorationRpcPrice?: (orgDecorationId: string, qty: number) => number | null
  /** Return value for catalogue_item_decoration_price, keyed by catalogue_item_id. */
  manualCombinedPrice?: (catalogueItemId: string, qty: number) => number | null
  garmentUnitPrice?: number
  /** Inject an error for a table's select (message → PostgREST-style error). */
  selectErrorFor?: Record<string, string>
}

export function makeFanoutStub(config: StubConfig) {
  const rpcCalls: RpcCallRecord[] = []
  const fromCounts = new Map<string, number>()

  const itemRows = config.items.map((i) => ({
    id: i.id,
    source_product_id: i.sourceProductId,
    price_mode: i.priceMode,
    moq_override: i.moqOverride ?? null,
    fulfilment_type_override: i.fulfilmentTypeOverride ?? null,
    catalogue_id: i.catalogueId ?? 'cat-stub',
    b2b_catalogues: { decoration_pooling_enabled: i.poolingEnabled === true },
  }))

  // org_decorations, as read by loadPoolableDecorationIds. Deduped by id: one
  // decoration is typically attached to many garments via many link rows.
  const decorationRows = Array.from(
    new Map(
      config.links.map((l) => [
        l.orgDecoration.id,
        {
          id: l.orgDecoration.id,
          artwork_id:
            l.orgDecoration.artworkId === undefined ? 'art-stub' : l.orgDecoration.artworkId,
          decoration_method: l.orgDecoration.method ?? 'screenprint',
          organization_id: l.orgDecoration.organizationId,
        },
      ]),
    ).values(),
  )
  const productRows = config.products.map((p) => ({
    id: p.id,
    moq: p.moq ?? 1,
    fulfilment_type: p.fulfilmentType ?? 'made_to_order',
  }))
  const linkRows = config.links.map((l) => ({
    id: l.id,
    catalogue_item_id: l.catalogueItemId,
    unit_price_override: l.unitPriceOverride ?? null,
    snapshot_url: l.snapshotUrl ?? null,
    __is_published: l.isPublished ?? true,
    b2b_catalogue_items: { id: l.catalogueItemId, source_product_id: l.sourceProductId },
    org_decorations: {
      id: l.orgDecoration.id,
      organization_id: l.orgDecoration.organizationId,
      name: l.orgDecoration.name,
      decoration_method: l.orgDecoration.method ?? 'screenprint',
      unit_price: l.orgDecoration.unitPrice,
      is_active: l.orgDecoration.isActive ?? true,
      width_mm: null,
      height_mm: null,
      colour_count: null,
      organization_artworks: null,
      decoration_locations: null,
    },
  }))

  function responseFor(table: string, filters: Array<{ op: string; column: string; value: unknown }>) {
    const err = config.selectErrorFor?.[table]
    if (err) return { data: null, error: { message: err } }
    if (table === 'user_organizations') return { data: [{ role: 'org_admin' }], error: null }
    if (table === 'b2b_catalogue_items') return { data: itemRows, error: null }
    if (table === 'org_decorations') {
      let rows = decorationRows
      for (const f of filters) {
        if (f.op === 'in' && f.column === 'id') {
          const ids = new Set(f.value as string[])
          rows = rows.filter((r) => ids.has(r.id))
        }
      }
      return { data: rows, error: null }
    }
    if (table === 'products') return { data: productRows, error: null }
    if (table === 'b2b_catalogue_item_decorations') {
      let rows = linkRows
      for (const f of filters) {
        if (f.op === 'in' && f.column === 'id') {
          const ids = new Set(f.value as string[])
          rows = rows.filter((r) => ids.has(r.id))
        }
        if (f.op === 'eq' && f.column === 'is_published') {
          rows = rows.filter((r) => r.__is_published === f.value)
        }
      }
      // strip the stub-internal flag so consumers see the PostgREST shape
      return {
        data: rows.map(({ __is_published, ...rest }) => {
          void __is_published
          return rest
        }),
        error: null,
      }
    }
    if (table === 'b2b_accounts') {
      if (!config.tier) return { data: [], error: null }
      return {
        data: [
          {
            tier_discount_override: config.tier.tierDiscountOverride ?? null,
            customer_pricing_tiers: { multiplier: config.tier.multiplier ?? 1 },
          },
        ],
        error: null,
      }
    }
    if (table === 'quote_items') {
      return {
        data: [
          {
            id: 'qi-1',
            product_id: config.products[0]?.id,
            variant_id: null,
            size_id: null,
            product_name: 'Stub product',
            quantity: 10,
            unit_price: config.garmentUnitPrice ?? 12.5,
            decorations: [],
            size_label: null,
            product_variants: null,
          },
        ],
        error: null,
      }
    }
    if (table === 'quotes') {
      return {
        data: [
          {
            id: 'quote-1',
            organization_id: 'org-stub',
            customer_name: 'Acme Co',
            customer_email: 'buyer@acme.test',
            order_ref: 'ORD-TEST-1',
            total_amount: 125,
            required_by: null,
            payment_terms: 'net20',
          },
        ],
        error: null,
      }
    }
    if (table === 'organizations') return { data: [{ is_test: true }], error: null }
    return { data: [], error: null }
  }

  function builderFor(table: string) {
    const filters: Array<{ op: string; column: string; value: unknown }> = []
    let pendingWrite = false

    const settle = () => {
      if (pendingWrite) return { data: null, error: null }
      return responseFor(table, filters)
    }

    const builder = {
      select: () => builder,
      insert: () => {
        pendingWrite = true
        return builder
      },
      update: () => {
        pendingWrite = true
        return builder
      },
      eq: (column: string, value: unknown) => {
        filters.push({ op: 'eq', column, value })
        return builder
      },
      in: (column: string, value: unknown) => {
        filters.push({ op: 'in', column, value })
        return builder
      },
      is: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => {
        const r = settle()
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }
      },
      maybeSingle: async () => {
        const r = settle()
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }
      },
      then<R1, R2 = never>(
        resolve: (v: { data: unknown; error: { message: string } | null }) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): PromiseLike<R1 | R2> {
        return Promise.resolve(settle()).then(resolve, reject)
      },
    }
    return builder
  }

  const admin = {
    from: vi.fn((table: string) => {
      fromCounts.set(table, (fromCounts.get(table) ?? 0) + 1)
      return builderFor(table)
    }),
    rpc: vi.fn(async (name: string, args?: AnyRow) => {
      rpcCalls.push({ name, args })
      if (name === 'effective_unit_price_for_item' || name === 'effective_unit_price') {
        return { data: config.garmentUnitPrice ?? 12.5, error: null }
      }
      if (name === 'effective_decoration_unit_price') {
        const v = config.decorationRpcPrice?.(
          args?.p_org_decoration_id as string,
          args?.p_qty as number,
        )
        return { data: v ?? null, error: null }
      }
      if (name === 'catalogue_item_decoration_price') {
        const v = config.manualCombinedPrice?.(
          args?.p_catalogue_item_id as string,
          args?.p_qty as number,
        )
        return { data: v ?? null, error: null }
      }
      if (name === 'submit_b2b_order') {
        return {
          data: [{ quote_id: 'quote-1', order_id: 'order-1', order_ref: 'ORD-TEST-1' }],
          error: null,
        }
      }
      return { data: null, error: null }
    }),
  } as unknown as Parameters<typeof submitCustomerOrder>[0]

  const rpcCount = (name: string) => rpcCalls.filter((c) => c.name === name).length
  const fromCount = (table: string) => fromCounts.get(table) ?? 0

  return { admin, rpcCalls, rpcCount, fromCount }
}

export function makeContext(orgId: string) {
  return {
    userId: 'user-stub',
    membershipId: 'membership-stub',
    role: 'org_admin' as const,
    email: 'buyer@acme.test',
    fullName: 'Sam Buyer',
    organizationId: orgId,
    organizationName: 'Acme Co',
    customerCode: 'ACME',
    isTest: false,
    b2bAccountId: null,
    tierLevel: null,
    paymentTerms: 'net20',
    contractNotes: null,
    pricingMode: null,
    defaultDepositPercent: null,
    storeIds: [],
    defaultStoreId: null,
    branchStoreIds: [],
    tenantType: null,
    allowsMultiStoreOrdering: false,
    moqExempt: true,
    orderingPermission: 'both' as const,
  }
}
