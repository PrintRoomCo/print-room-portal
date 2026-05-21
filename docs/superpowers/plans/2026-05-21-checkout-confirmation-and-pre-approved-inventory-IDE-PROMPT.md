# IDE PROMPT — Checkout confirmation polish + Pre-approved inventory write-through

**Date:** 2026-05-21
**Owner / controller:** Jamie (Print Room)
**Repos touched:**
- `print-room-portal` (customer-side checkout + confirmation + inventory write)
- `print-room-staff-portal` (only if Stage 1's RPC change lives there — see §Stage 1)
**Branches:** one branch per repo, e.g.
- portal: `fix/checkout-confirmation-and-preapproved-inventory`
- staff: `feat/submit-b2b-order-pre-approved-inventory` *(only if Stage 1 lands here)*

---

## Why this PR

Four follow-ups landed after the 2026-05-21 Checkout → Monday → Auto-proof pipeline shipped:

1. **"Add all to my inventory" is dead at submit-time.** Today, ticking the toggle sets `orders.intent = 'inventory'` on the row, but `submit_b2b_order` does **not** increment `variant_inventory.stock_qty` — stock only lands when staff later runs `mark_inventory_received` after fulfilment. Jamie's call: when the customer ticks the toggle, treat the order as **pre-approved inventory** — write to `variant_inventory` immediately so it shows up on the staff inventory page **and** on the customer PDP availability. Audit each line with `reason = 'pre_approved_inventory'`.
2. **Confirmation page header copy is stale.** The previous pipeline gated on AM approval, so the page surfaces "Awaiting staff proof review" + a long receipt blurb. The new flow auto-approves at submit, so the page should lead with **"Order received"** + a short sub-line ("We're preparing your proof.").
3. **Order-summary fallback ("Items will appear here once they finish syncing") is a lie.** The lines query at `app/(portal)/checkout/confirmation/[orderId]/page.tsx:152` is synchronous against `quote_items`. If it returns empty, there is no async sync that will populate them later — the message is misleading. Either (a) ensure the fetch always succeeds before render, or (b) replace the message with a true error state.
4. **Shipping-to label is wrong for inventory orders.** When `orders.intent = 'inventory'`, the order ships to **Print Room warehouse**, not to a buyer address. The confirmation page currently renders `quotes.shipping_address` regardless — which is the buyer's address baked in by the RPC.

---

## Decisions already locked

| # | Question | Decision |
|---|----------|----------|
| 1 | When should pre-approved inventory hit `variant_inventory`? | At checkout submit, immediately after the `submit_b2b_order` RPC succeeds, before the Monday push (so a Monday failure doesn't undo it). |
| 2 | Should `prepaid` be `true` for pre-approved inventory? | **No.** `prepaid = false` — the customer is being invoiced normally; `prepaid` is reserved for stock the org actually paid up-front for. The "pre-approved" signal lives in `reason` + `note`, not in `prepaid`. |
| 3 | What `p_unit_value` to pass to `mark_inventory_received`? | Use the `quote_items.unit_price` (post-decoration-fold) at submit time — the price the customer was charged. |
| 4 | Are the existing per-line inventory ticks (mixed mode) in scope? | No. v1 honours **`orders.intent = 'inventory'` only** (all-on case). If the RPC ever supports mixed mode, this code grows. |
| 5 | Confirmation page sub-header copy | "We're preparing your proof." (one line, secondary text style). |
| 6 | What to show on the order-summary when `lines.length === 0`? | Replace the misleading "syncing" copy with `"No items recorded for this order. Email us so we can sort it."` + log to console.error so we notice if it ever fires. |
| 7 | Warehouse address shape | Render `"Print Room warehouse"` + sub-line `"Stock lands on your inventory shelf at Print Room."` — matches the checkout-page inventory-mode banner already in `CheckoutClient.tsx`. No actual street address. |

Nothing Jon-blocked.

---

## Files in scope (read-only references)

**Portal:**
- `app/(portal)/checkout/confirmation/[orderId]/page.tsx` — Confirmation server page, runs the DB queries.
- `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx` — Confirmation client view, all copy + layout.
- `lib/checkout/submit.ts` — Checkout server flow; step 5 pushes Monday + flips status. The new inventory-write hook lands **between** the RPC call (line ~637) and the Monday push (line ~759). See Stage 2.
- `lib/audit/actions.ts` — Add new audit action constant.
- `components/checkout/CheckoutClient.tsx:296-302` — Existing inventory-mode banner copy (reuse the wording on the confirmation page).

**Staff portal (Stage 1 only):**
- `src/app/api/inventory/[orgId]/variants/[variantId]/adjust/route.ts` — Existing surface that calls `mark_inventory_received`. **Don't reuse this route** for checkout — it requires staff auth. We're calling the RPC directly from the portal's service-role admin client.
- `supabase/migrations/20260513060737_mark_inventory_received_rpc.sql` — RPC source. Read to confirm signature before calling.

---

## Stage 1 — Pre-flight: confirm `mark_inventory_received` is callable with `reason = 'pre_approved_inventory'`

**Goal:** Avoid the Stage-1 surprise we hit last sprint. Before touching app code, **read the RPC source** and confirm its acceptance criteria for `p_reason`.

**Steps:**

1. Open `print-room-staff-portal/supabase/migrations/20260513060737_mark_inventory_received_rpc.sql`. Verify:
   - Full parameter list (especially: `p_reason text`, `p_note text`, `p_reference_quote_item_id uuid`, `p_unit_value numeric`, `p_prepaid bool`).
   - Whether `p_reason` is constrained to a known set (CHECK or `IN (...)` guard). If yes, list allowed values.
2. If `p_reason` is unconstrained → use `'pre_approved_inventory'` as the literal.
3. If `p_reason` is constrained to a closed set that doesn't include `'pre_approved_inventory'` → **STOP**. Add `'pre_approved_inventory'` to the allowed set via a new migration in **staff repo**:
   - File: `print-room-staff-portal/supabase/migrations/20260521000010_inventory_reason_pre_approved.sql`
   - Body: extend the CHECK / drop+re-add with the new value. Idempotent (`IF EXISTS` guards).
   - Apply via Supabase MCP `apply_migration`.
4. Confirm `variant_inventory_events.reason` column accepts free-text or matches the same constraint. Mirror the same migration if needed.

**Acceptance:** Manually call the RPC via Supabase MCP `execute_sql` against a known org+variant with `p_reason = 'pre_approved_inventory'` and verify (a) `variant_inventory.stock_qty` incremented, (b) a `variant_inventory_events` row landed with the new reason. Roll back the test write with a manual `UPDATE` / `DELETE` before continuing.

---

## Stage 2 — Pre-approved inventory write on submit (portal)

**File:** `print-room-portal/lib/checkout/submit.ts`

**Where:** New block between the `submit_b2b_order` RPC call (`const { data, error } = await admin.rpc('submit_b2b_order', …)` ~line 637-679) and step 5's Monday push (`// 5a. Push to Monday CRM Deals board.` ~line 751).

**Logic:**

```ts
// 4b. Pre-approved inventory write-through.
//     When the customer ticked "Add all to my inventory" the order's intent
//     is 'inventory'. Today the RPC sets the flag but does NOT touch stock —
//     stock only lands when staff later runs mark_inventory_received post-
//     fulfilment. Jamie 2026-05-21: at submit, treat each line as pre-approved
//     inventory and write the stock immediately so it shows on the staff
//     inventory page and the customer PDP availability the moment the order
//     posts. Best-effort: a failure here logs + audits but does NOT roll back
//     the order.
if ((input.intent ?? 'customer') === 'inventory') {
  try {
    // Re-fetch lines so we have the persisted variant_id + canonical
    // unit_price (post-decoration-fold). Cheaper than re-deriving from `repriced`
    // and avoids drift if the RPC ever normalises the prices further.
    const { data: invLines, error: invErr } = await admin
      .from('quote_items')
      .select('id, variant_id, quantity, unit_price')
      .eq('quote_id', quote_id)
    if (invErr) throw new Error(`pre-approved inventory line lookup failed: ${invErr.message}`)
    const rows = (invLines ?? []) as Array<{
      id: string
      variant_id: string | null
      quantity: number | null
      unit_price: number | null
    }>
    const skipped: string[] = []
    for (const r of rows) {
      if (!r.variant_id || !r.quantity || r.quantity <= 0) {
        skipped.push(r.id)
        continue
      }
      const { error: rpcErr } = await admin.rpc('mark_inventory_received', {
        p_org_id: input.context.organizationId,
        p_variant_id: r.variant_id,
        p_qty: r.quantity,
        p_prepaid: false,
        p_unit_value: Number(r.unit_price ?? 0),
        p_reason: 'pre_approved_inventory',
        p_note: `Pre-approved at checkout — order ${order_ref}`,
        p_reference_quote_item_id: r.id,
        // p_staff_user_id intentionally omitted — there's no staff actor here.
      })
      if (rpcErr) throw new Error(`mark_inventory_received failed for line ${r.id}: ${rpcErr.message}`)
    }
    await recordAuditEvent(
      {
        orgId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: AUDIT_ACTIONS.ORDER_PRE_APPROVED_INVENTORY,
        targetType: 'order',
        targetId: order_id,
        metadata: { order_ref, quote_id, line_count: rows.length, skipped },
      },
      admin,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[Checkout] pre-approved inventory write failed (swallowed)', {
      orderId: order_id,
      err: message,
    })
    try {
      await recordAuditEvent(
        {
          orgId: input.context.organizationId,
          actorUserId: input.context.userId,
          action: AUDIT_ACTIONS.ORDER_PRE_APPROVED_INVENTORY_FAILED,
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
}
```

**Audit constants** (`lib/audit/actions.ts`):

```ts
ORDER_PRE_APPROVED_INVENTORY: 'order.pre_approved_inventory',
ORDER_PRE_APPROVED_INVENTORY_FAILED: 'order.pre_approved_inventory_failed',
```

**Acceptance:**

- Unit test (new file `lib/checkout/__tests__/submit.pre-approved-inventory.test.ts`):
  - Given `intent = 'inventory'`, the RPC `mark_inventory_received` is called once per line with the correct `p_qty` + `p_unit_value` + `p_reason = 'pre_approved_inventory'`.
  - Given a single RPC error, the order still commits, an `ORDER_PRE_APPROVED_INVENTORY_FAILED` audit row is written.
  - Given `intent = 'customer'`, the RPC is **not** called.
- Manual smoke (after deploy):
  - Tick "Add all to my inventory" at checkout, submit.
  - Confirm `variant_inventory.stock_qty` for the tested variants increased by the ordered quantity (Supabase MCP `execute_sql`).
  - Confirm `variant_inventory_events` rows exist with `reason = 'pre_approved_inventory'` and `reference_quote_item_id` matches.
  - Confirm the staff portal inventory page (`/inventory/[orgId]/variants`) shows the new stock.
  - Confirm the customer PDP (`/catalogue/[productId]`) availability shows the new stock.

**Out of scope:** Mixed-mode (some lines to inventory, some to customer) — `orders.intent` is order-level, not line-level.

---

## Stage 3 — Confirmation page copy + layout (portal)

**Files:**
- `app/(portal)/checkout/confirmation/[orderId]/page.tsx`
- `app/(portal)/checkout/confirmation/[orderId]/ConfirmationView.tsx`

### 3.1 Server: fetch `orders.intent` + pass it down

In `page.tsx`:
- Extend the `OrderRow` type with `intent: string | null`.
- Add `intent` to the `.select('id, status, total_price, intent, ...')` list (line ~109).
- Derive `const isInventoryOrder = order.intent === 'inventory'` and pass it as a new prop to `ConfirmationView`.

### 3.2 Server: replace the misleading "syncing" copy and log empty-lines

In `page.tsx` after the `lineRows` mapping (~line 165):
```ts
if (lineRows.length === 0) {
  console.error('[confirmation] empty_lines', { orderId, quoteId: order.quotes.id })
}
```
No fallback array — we already pass `lines: []` and the view handles the empty case (copy fix below).

### 3.3 Client: copy + badge changes

In `ConfirmationView.tsx`:

**a) Replace the hero block (lines ~114-144):**

```tsx
<header className="mb-10 md:mb-14">
  <p className={LABEL_CAP}>Order #{orderRef}</p>
  <h1 className="mt-4 font-dm-sans font-medium leading-[1.05] tracking-[-0.02em] text-[clamp(40px,5vw,72px)] text-gray-900">
    Order received
  </h1>
  <p className="mt-4 text-lg text-gray-600">
    We&rsquo;re preparing your proof.
  </p>
  {proofReady && (
    <div className="mt-5">
      <Link
        href={`/orders/${orderId}/proof`}
        className="inline-flex items-center justify-center rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
      >
        Your proof is ready — open the order to review
      </Link>
    </div>
  )}
</header>
```

Drop entirely:
- The `<p className="mt-5 max-w-2xl text-base text-gray-600">…receipt to {customerEmail}…</p>` paragraph.
- The two `awaitingApproval` / `!awaitingApproval` badge branches.

The `awaitingApproval` and `mondaySynced` props can stay in the interface for now (still consumed by the right-rail "Production sync is still finishing" hint at line ~368). If they end up fully unused after this PR, remove on the same branch — don't leave dead props.

**b) Replace the order-summary empty fallback (lines ~154-157):**

```tsx
{lines.length === 0 ? (
  <p className="text-sm text-gray-500">
    No items recorded for this order. <a className="underline" href={SUPPORT_MAILTO}>Email us</a> so we can sort it.
  </p>
) : (
  …
)}
```

**c) Inventory-aware shipping label (lines ~239-255):**

Add `isInventoryOrder: boolean` to `ConfirmationViewProps`. In the Delivery section:

```tsx
<div>
  <p className="mb-2 text-xs font-medium text-gray-500">
    {isInventoryOrder ? 'Stock destination' : 'Shipping to'}
  </p>
  {isInventoryOrder ? (
    <div className="space-y-0.5 text-gray-900">
      <p>Print Room warehouse</p>
      <p className="text-xs text-gray-500">
        Stock lands on your inventory shelf at Print Room.
      </p>
    </div>
  ) : addressLines.length > 0 ? (
    <div className="space-y-0.5 text-gray-900">
      {addressLines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  ) : (
    <p className="text-gray-500">
      Address will be confirmed by your account manager.
    </p>
  )}
</div>
```

**Acceptance:**

- Visit `/checkout/confirmation/[orderId]` for an inventory-intent order:
  - Header reads "Order received" with sub-line "We're preparing your proof."
  - No receipt-email paragraph.
  - No "Awaiting staff proof review" badge.
  - Delivery section shows "Stock destination → Print Room warehouse / Stock lands on your inventory shelf at Print Room."
  - Order summary lists each line item (not the empty fallback).
- Visit the same page for a customer-intent order:
  - Same header + sub-line as above.
  - Delivery section shows "Shipping to → {address lines}" as before.
- Snapshot test (Vitest + RTL): empty-lines case renders the new "No items recorded…" copy and `console.error` is called once with `{ orderId, quoteId }`.

---

## Stage 4 — Tests + sprint doc

1. Run `pnpm typecheck` + `pnpm test` in `print-room-portal`. All green.
2. If Stage 1 added a staff migration, run the staff repo's typecheck too (`npm run typecheck`).
3. Append a 1-page sprint doc to `print-room-portal/docs/superpowers/sprint-docs/2026-05-21-confirmation-and-pre-approved-inventory.md`:
   - **What shipped:** confirmation copy realign + pre-approved inventory write-through.
   - **Why:** auto-approve checkout makes the old "awaiting proof review" copy false; "add all to my inventory" was wired in the UI but inert at the data layer.
   - **How it works:** at submit, if `orders.intent='inventory'`, the portal calls `mark_inventory_received` per line with `reason='pre_approved_inventory'`; confirmation page reads `orders.intent` to branch the Delivery label.
   - **Key decisions:** `prepaid=false`; reason text new value; best-effort + audited; v1 = all-on only.
   - **Gotchas:** mixed-mode not supported; if `mark_inventory_received` ever adds new required params, the inventory write block needs updating; the misleading "syncing" copy was always a lie (no async sync existed).
   - **Where:** file paths for the 3 touched files + audit constants + new test.

---

## PR template (per repo)

```
## Summary
- Pre-approved inventory writes through to variant_inventory at checkout
- Confirmation page header + delivery copy realigned to the auto-approve flow
- Empty-lines fallback no longer claims items are "syncing" (they never were)

## Test plan
- [ ] Submit checkout with "Add all to my inventory" ticked — variant_inventory stock_qty increases for each line; variant_inventory_events rows appear with reason='pre_approved_inventory'
- [ ] Staff inventory page shows the new stock
- [ ] Customer PDP availability shows the new stock
- [ ] Confirmation page renders "Order received / We're preparing your proof." (no receipt blurb, no proof-review badge)
- [ ] Inventory-intent confirmation page shows "Stock destination → Print Room warehouse"
- [ ] Customer-intent confirmation page still shows the buyer address
- [ ] Order summary lists line items for a real order (no false "syncing" copy)
```

---

## Out of scope (deferred)

- Mixed-mode per-line inventory routing at submit (the RPC doesn't support it yet).
- Removing the now-vestigial `awaitingApproval` / `mondaySynced` props — defer until the right-rail "Production sync still finishing" hint is also rewritten.
- The pre-existing `proof.autofill_failed: column product_print_areas_2.view does not exist` bug surfaced in the last smoke — separate ticket.
- Email-template review (the order-confirmation email still describes the old flow; not in this PR).

## Open questions

None — Jamie's brief locks everything above. If Stage 1's pre-flight reveals the RPC signature drifted (e.g. `p_reason` removed entirely), pause and surface before guessing.
