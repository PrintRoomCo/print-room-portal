# IDE prompt — repoint the customer-order Monday push from CRM Deals → Production / "Pre-production"

> Paste everything below the line into your in-repo IDE agent (run it inside `print-room-portal`).
> Board id was confirmed live via the Monday MCP on 2026-07-01: **Production board = `1992701981`**, group **"Pre-production" = group id `topics`**, account slug `theprint-room-group`.

---

## Objective

When a customer submits a B2B order at `/checkout`, the portal currently creates a Monday item on the **CRM Deals board (`2046357917`)** in the `topics` ("New Deals") group. Move **the order path only** so new orders land on the **Production board (`1992701981`)** in the **"Pre-production" group (`topics`)** instead, with columns mapped to the Production board's schema. Leave every downstream behaviour (order status flip, `orders.monday_item_id` / `job_trackers` linking, AM proof notify, inbound tracker-status webhook) working.

## Where the code is (start here, verify before editing)

- `lib/checkout/submit.ts` — **step 5** calls `pushOrderDeal(...)` from `lib/monday/deal-item.ts`, then stamps `orders.monday_item_id` and links `job_trackers.monday_item_id`, then flips the order to `awaiting-proof-review`.
- `lib/monday/deal-item.ts` — the integration. Relevant exports:
  - `pushOrderDeal()` → `createOrderDealItem()` + per-line `createOrderDealSubitem()` (**ORDER mode — this is what moves**).
  - `createReorderItem()` (**REORDER mode — do NOT move unless told to, see Decision 1**).
  - Board resolved by `getBoardId()` = `process.env.MONDAY_REORDERS_BOARD_ID` (the CRM Deals board, shared by both modes today).
  - Group resolved by `resolveDealsGroupId(opts?.demo)` = `'topics'`, or `MONDAY_DEMO_GROUP_ID` for `org.is_test` demo orders.
  - Order columns: `COL_CUSTOMER_NAME/COL_EMAIL/COL_PRODUCT/COL_FULL_FORM_RESPONSE/COL_DEAL_STAGE/COL_DEAL_SOURCE/COL_QTY/COL_IN_HAND_DATE` — **these ids are CRM-Deals-board-specific and do NOT exist on the Production board.**
- `lib/monday/column-ids.ts` — **already** defines `PRODUCTION_BOARD_ID = 1992701981`, `PRODUCTION_COLUMNS`, and `PRODUCTION_SUBITEM_COLUMNS` (per-size numeric columns). Reuse these — do not hardcode new literals.
- `app/api/webhooks/monday/tracker-status/route.ts` — inbound webhook that **already** branches on `PRODUCTION_BOARD_ID`. Moving order items onto the Production board is the intended completion of this pipeline; make sure you don't regress it.
- Deep links: `components/leavers-admin/QuoteDetail.tsx` and the AM notify path (`lib/proofs/autofill-for-order.ts` / `notifyAmBestEffort`) build `…monday.com/boards/<boardId>/pulses/<itemId>` from a stored board id + `MONDAY_BOARD_URL_PREFIX`. These must resolve to the **Production** board for orders.

## Tasks

1. **Split board/group resolution by mode.** Keep reorders on `getBoardId()` (`MONDAY_REORDERS_BOARD_ID` = Deals). Add an order-path board resolver that returns `PRODUCTION_BOARD_ID` (allow an optional `MONDAY_PRODUCTION_BOARD_ID` env override, defaulting to the constant). Order group id = `topics` ("Pre-production"); confirm the live group id via the Monday API at build time (groups can be renamed/reordered — `topics` is correct as of 2026-07-01).

2. **Remap the order item columns** in `createOrderDealItem()` from the `COL_*` Deals ids to `PRODUCTION_COLUMNS`. Mapping:

   | Order data | Deals column (old) | Production column (new) |
   |---|---|---|
   | customer email | `COL_EMAIL` (`email_mkzjab7s`) | `PRODUCTION_COLUMNS.customerEmail` (`email_mkqjpxt3`) |
   | order ref | (in item name / `COL_PRODUCT`) | `PRODUCTION_COLUMNS.poRef` (`text_mkqxcmvz`) |
   | total amount | — | `PRODUCTION_COLUMNS.quoteTotal` (`numeric_mkpqavfj`) |
   | in-hand date | `COL_IN_HAND_DATE` (`date_mm0p5fzc`) | `PRODUCTION_COLUMNS.inHandDate` (`date_mky2nyht`) |
   | full breakdown text | `COL_FULL_FORM_RESPONSE` (`long_text_mkzjhs9j`) | a Production long-text col — use "Job Specs ℹ️" (`long_text_mkrr4994`); confirm via API |
   | tracker token / URL | — | `PRODUCTION_COLUMNS.trackerUrl` (`text_mkxvmsha`) and/or `customerTrackingUrl` (`link_mky1w9w`) when available |
   | initial status | `COL_DEAL_STAGE`/`COL_DEAL_SOURCE` (CRM-only) | optionally set `PRODUCTION_COLUMNS.mainStatus` (`color_mkpnas0e`) to a valid pre-production label — **fetch the board's status labels first**; do not invent one |

   **Drop the CRM-only fields** (`deal_stage`, `deal_source`, deal-specific qty/company/phone text cols) — they don't exist on Production. If order provenance still matters, tag the Production "Intent" status (`color_mm3fdn3a`) or "Enquiry Type" text (`text_mkrsdfzd`) instead; otherwise omit. Item NAME keeps the `Customer - Company - OrderRef` format.

3. **Keep sub-items working.** Continue creating one sub-item per cart line via `createOrderDealSubitem()` (name-only is fine for v1 — sub-item columns are optional). `PRODUCTION_SUBITEM_COLUMNS` exists if you later want per-size/sku/colour population, but that needs extra fields plumbed from `lib/checkout/submit.ts` — leave as a flagged follow-up, not this change.

4. **Fix the AM deep link / stored board id.** Wherever the order flow persists a Monday board id for deep links (e.g. `quotes.monday_board_id`) or builds the AM email link, use `PRODUCTION_BOARD_ID` for orders so links open the Production item, not a dead Deals URL.

5. **Config + docs.** Add `MONDAY_PRODUCTION_BOARD_ID` (default `1992701981`) to `.env.example` with a comment, only if you chose the env-override approach. Update the file header doc in `deal-item.ts` (it currently says orders go to the Deals "New Deals" group).

## Decisions to confirm before finishing

1. **Reorders** (`createReorderItem`) — leave on the CRM Deals board (recommended; reorders are an AM/CRM routing concern), or move them to Pre-production too? Default: **leave on Deals.**
2. **Demo/test orders** — `MONDAY_DEMO_GROUP_ID` is a group on the **Deals** board, so it won't exist on Production. Either route demo orders to `topics` on Production as well, or introduce `MONDAY_PRODUCTION_DEMO_GROUP_ID`. Default: **route demo orders to `topics` on Production** (simplest) and log a warning if a dedicated demo group isn't set.
3. **Initial Job Status** — set a starting `mainStatus` label, or leave blank? Confirm the board's available labels first.

## Gotchas (do not skip)

- Column ids are **board-specific** — a raw board swap without the remap in Task 2 makes `create_item` fail with `ColumnValueException`. Only send columns that exist on the Production board.
- The inbound `tracker-status` webhook keys off `PRODUCTION_BOARD_ID`. Confirm the Monday-side webhook **subscription** is actually pointed at the Production board (Monday → board → Integrations / the existing `MONDAY_WEBHOOK_SECRET` wiring). If it currently only watches Deals, status/date round-trips won't fire until that subscription is added on Production. Flag this to the human if you can't verify it from code.
- `MONDAY_PRODUCTION_BOARD_ID` (if added) must be set in **Vercel** (Production + Preview) — you can't do that from code; call it out in the PR description.

## Verify (in a preview/staging env, not prod)

1. Place a test B2B order → assert the Monday item lands on board `1992701981`, group **Pre-production**, with email/poRef/total/in-hand/specs populated and one sub-item per line.
2. Assert `orders.monday_item_id` is stamped and the matching `job_trackers.monday_item_id` is linked; order status flips to `awaiting-proof-review`.
3. Open the AM deep link → it resolves to the Production item.
4. Trigger a status/date change on that Production item → confirm `tracker-status` webhook updates the tracker.
5. Place a test **reorder** → confirm it still lands on the CRM Deals board (unchanged).
6. Delete the test item from Monday + the test rows from the DB afterward.

## Out of scope (do NOT touch)

- `print-room-chatbot-api` (`api/services/monday.ts`, `monday-quote.ts`, `api/leavers/submit.ts`) — a **separate app** that pushes public chatbot/leavers **quotes** to the Deals board. Different pipeline; leave it on Deals.
- The reorder path, unless Decision 1 says otherwise.

## Done when

- [ ] Orders create items on Production `1992701981` / group `topics`, columns remapped, sub-items intact.
- [ ] Reorders unchanged on Deals (or moved per Decision 1).
- [ ] Deep links + AM notify resolve to the Production board.
- [ ] Demo-order routing handled (Decision 2).
- [ ] Type-check + tests green; `.env.example`/docs updated; PR notes the Vercel env + Monday webhook-subscription follow-ups.
