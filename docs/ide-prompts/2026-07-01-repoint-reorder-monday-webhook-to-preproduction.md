# IDE prompt — repoint the customer-REORDER Monday push from CRM Deals → Production / "Pre-production"

> Paste everything below the line into your in-repo IDE agent (run it inside `print-room-portal`).
> Sibling of `2026-07-01-repoint-order-monday-webhook-to-preproduction.md`. **Apply that ORDER prompt first**, then this — together they retire the CRM Deals board from the portal's push entirely (see "Coordination" below).
> Confirmed live via Monday MCP on 2026-07-01: **Production board = `1992701981`**, group **"Pre-production" = `topics`**, account slug `theprint-room-group`.

---

## Objective

When a customer reorders from a past job (the "Reorder" flow), the portal currently creates a Monday item on the **CRM Deals board (`2046357917`)** in the `topics` ("New Deals") group via `createReorderItem`. Move it so reorders land on the **Production board (`1992701981`)**, group **"Pre-production" (`topics`)** — the same destination as fresh orders — with columns mapped to the Production board's schema. Keep every downstream behaviour working, and keep reorders visually distinguishable from fresh orders in that shared group.

## Coordination with the ORDER prompt (read first)

`getBoardId()` (= `process.env.MONDAY_REORDERS_BOARD_ID`, the Deals board) is **shared** today by both `createReorderItem` (reorders) and `createOrderDealItem` (orders). The order prompt repoints orders and leaves reorders on `getBoardId()`. This prompt repoints reorders too. Once **both** are applied:

- Both modes should resolve to the Production board via a single helper (e.g. `getProductionBoardId()` → `PRODUCTION_BOARD_ID`, optional `MONDAY_PRODUCTION_BOARD_ID` env override). Consolidate rather than leaving two copies.
- `getBoardId()` / `MONDAY_REORDERS_BOARD_ID` then has **no caller left in `deal-item.ts`** — but it's still read by `lib/proofs/autofill-for-order.ts:303` for the AM deep-link board id (Task 4). Repoint that too, then remove the dead `MONDAY_REORDERS_BOARD_ID` (and its `.env.example` line + the `getBoardId` throw) only once nothing references it.
- If you are running this prompt **standalone** (orders staying on Deals — unusual), keep `getBoardId()` for orders and give reorders their own Production resolver instead of consolidating.

## Where the code is (verify before editing)

- `lib/monday/deal-item.ts` → **`createReorderItem(data: ReorderData)`** (the REORDER-mode export). Today: `boardId: getBoardId()` (Deals), `groupId: DEALS_GROUP_ID` (`'topics'`, used **directly** — reorders have no demo-group branch), CRM Deals column ids (`COL_*`), **no sub-items** (lines are packed into `buildFullFormResponse` long text), `deal_source = "Portal - Reorder"`, `deal_stage = "New"`.
- `app/api/reorder/route.ts` → builds `reorderData` via `buildReorderDataFromTracker(tracker, {...})` (~line 222) then calls `createReorderItem(reorderData)` (~line 233). Check what it does with the returned `itemId` afterward (persisted board id / tracker link / any AM notify) and make those resolve to the **Production** board.
- `lib/monday/column-ids.ts` → reuse `PRODUCTION_BOARD_ID = 1992701981` and `PRODUCTION_COLUMNS`. No inline literals.
- `lib/proofs/autofill-for-order.ts:303` → reads `MONDAY_REORDERS_BOARD_ID` for the deep-link board id.
- Tests that hardcode the board / group (update these): `lib/monday/__tests__/deal-item.demo-group.test.ts`, `lib/monday/__tests__/deal-item.order-mode.test.ts`, and the `lib/checkout/__tests__/submit.*.test.ts` set. Add a reorder-mode assertion that `createReorderItem` targets the Production board + `topics` group.

## Tasks

1. **Repoint the board/group** in `createReorderItem`: board → Production (via the shared `getProductionBoardId()` helper from the order prompt, or a new one if standalone); group id → `topics` ("Pre-production"). Confirm the live group id via the Monday API at build time (`topics` is correct as of 2026-07-01).

2. **Remap reorder columns** from the `COL_*` Deals ids to `PRODUCTION_COLUMNS`:

   | Reorder data | Deals column (old) | Production column (new) |
   |---|---|---|
   | customer email | `COL_EMAIL` (`email_mkzjab7s`) | `PRODUCTION_COLUMNS.customerEmail` (`email_mkqjpxt3`) |
   | original quote / job ref (`originalQuoteNumber` ‖ `originalJobReference`) | (in `COL_PRODUCT`/long text) | `PRODUCTION_COLUMNS.poRef` (`text_mkqxcmvz`) |
   | in-hand date | `COL_IN_HAND_DATE` (`date_mm0p5fzc`) | `PRODUCTION_COLUMNS.inHandDate` (`date_mky2nyht`) |
   | full reorder breakdown (`buildFullFormResponse` — original items, edits, address, notes, artwork/proof URLs) | `COL_FULL_FORM_RESPONSE` (`long_text_mkzjhs9j`) | "Job Specs ℹ️" (`long_text_mkrr4994`); confirm via API |
   | total qty | `COL_QTY` (`text_mkzjj9j5`) | "QTY" (`text_mkr4b1sm`) |
   | initial status | — | optionally `PRODUCTION_COLUMNS.mainStatus` (`color_mkpnas0e`) — fetch valid labels first, don't invent |

   **Drop CRM-only fields** (`deal_stage`, `deal_source`, the Deals-specific name/phone/company text cols) — they don't exist on Production. Keep the rich `buildFullFormResponse` text intact; it's the staff's source of truth for reorders.

3. **Preserve the reorder ↔ order distinction in the shared group.** Today `deal_source` separated `"Portal - Reorder"` from `"Portal - Order"`. On the shared Pre-production group, keep them tellable apart: the item NAME already ends in `- Reorder` (orders end in `- <orderRef>`), which is the minimum. Optionally also set the Production **"Intent"** status (`color_mm3fdn3a`) to a Reorder vs Order label (create-labels-if-missing) so staff can filter. Decide per Decision 1. Reorders stay **no-sub-items** (unchanged).

4. **Deep links.** Repoint `lib/proofs/autofill-for-order.ts:303` (and any board id the reorder route persists for deep links) from `MONDAY_REORDERS_BOARD_ID` to the Production board so links open the Production item. Verify `components/leavers-admin/QuoteDetail.tsx` deep links resolve correctly for reordered items too.

5. **Config, tests, docs.** Update the `deal-item.ts` file header (it says items go to the CRM Deals "New Deals" group). Update the hardcoded-board tests listed above and add a reorder-mode board/group assertion. Per Coordination: once nothing references it, remove `MONDAY_REORDERS_BOARD_ID` from `.env.example` and `getBoardId()`.

## Decisions to confirm before finishing

1. **Reorder vs order tag** on the shared Pre-production group — rely on the item-name suffix only (default, zero risk), or also set the "Intent" status so staff can filter Reorder vs Order? Recommended: **name suffix + Intent status.**
2. **Consolidate `getBoardId`?** If the order prompt is applied (it should be), merge both modes onto one Production board resolver and retire `MONDAY_REORDERS_BOARD_ID`. If standalone, don't.
3. **Demo/test reorders** — reorders currently have **no** demo-group branch (unlike orders), so all reorders incl. `org.is_test` go to `topics`. Keep that (they land in Pre-production like everything else), or add a demo split to match orders? Default: **keep — no demo branch for reorders.**

## Gotchas (do not skip)

- Column ids are **board-specific** — a board swap without the Task 2 remap makes `create_item` fail with `ColumnValueException`. Send only columns that exist on Production.
- The reorder route's post-create logic (tracker link / persisted board id / any notify) must point at Production, or you'll get dead Deals deep links for reorders.
- The inbound `app/api/webhooks/monday/tracker-status` route keys off `PRODUCTION_BOARD_ID`; make sure the Monday-side webhook **subscription** actually watches the Production board (same caveat as the order prompt).
- `MONDAY_PRODUCTION_BOARD_ID` (if you add the env override) must be set in **Vercel** (Production + Preview) — call it out in the PR; code can't set it.

## Verify (preview/staging, not prod)

1. Trigger a reorder from a completed job → assert the Monday item lands on board `1992701981`, group **Pre-production**, item name ends `- Reorder`, with email/poRef/in-hand/qty + the full breakdown in Job Specs, and **no** sub-items.
2. If you set the Intent tag, assert it reads "Reorder".
3. Assert any tracker/board-id the reorder route persists points at Production and the AM deep link opens the Production item.
4. Place a fresh **order** too → both land in Pre-production and are distinguishable (order has sub-items + `- <orderRef>` name; reorder has the breakdown + `- Reorder` name).
5. Type-check + tests green. Delete the test items from Monday + test rows from the DB afterward.

## Out of scope (do NOT touch)

- `print-room-chatbot-api` — separate app pushing public chatbot/leavers **quotes** to the Deals board. Leave on Deals.
- Reorder **normalization** (catalogue-identity rework described in `docs/superpowers/specs/2026-06-02-reorder-normalization-design.md`) — that's a bigger separate effort; this prompt only changes the Monday destination + column mapping.

## Done when

- [ ] Reorders create items on Production `1992701981` / group `topics`, columns remapped, no sub-items, distinguishable from orders.
- [ ] Board resolver consolidated with the order path (or standalone per Decision 2); `MONDAY_REORDERS_BOARD_ID` retired if unused.
- [ ] Deep links + any persisted board id resolve to Production.
- [ ] Type-check + tests green (incl. updated/added reorder board assertion); docs + `.env.example` updated; PR notes Vercel env + Monday webhook-subscription follow-ups.
