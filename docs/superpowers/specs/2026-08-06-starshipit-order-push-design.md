# Starshipit order-push — design spec

**Date:** 2026-08-06
**Repos:** `print-room-portal` (all code), `print-room-staff-portal` (one shared-schema migration)
**Status:** Design — awaiting review
**Supersedes/narrows:** the Starshipit half of `docs/2026-07-15-spec-b-dispatch-integrations.md` (item 12). Relates to the staff-portal fulfillment design `print-room-staff-portal/docs/superpowers/specs/2026-08-04-order-fulfillment-and-customer-visibility-design.md` (§7 Phases 3–5, which this build deliberately does **not** touch).

---

## 1. Goal (one sentence)

Push portal orders into the existing "Print Room Dispatch" Starshipit account so staff can print courier tickets from the same queue they already use — **the push side only**. Courier tracking, customer display, and dispatch email stay on the current Monday pipeline, untouched.

## 2. Decisions locked (from brainstorming 2026-08-06)

| # | Decision | Value |
|---|---|---|
| D1 | **Integration model** | Full shipping station — portal registers **unshipped** orders via `POST /api/orders`; staff print labels/tickets inside Starshipit's own UI. We do **not** build label printing into either portal. |
| D2 | **Account** | **Consolidate** onto the live "Print Room Dispatch" account (not a fresh account), so portal orders appear next to the Shopify/studio orders staff already print. Safe because the studio is decommissioned — no double-registration. |
| D3 | **Carrier** | Single carrier (NZ Post). No carrier-picker, no rate-shopping; Starshipit account rules assign NZ Post. |
| D4 | **Push trigger** | Stock-on-hand → push **at placement**. Made-to-order → push **when Monday production status flips to ready-to-dispatch**. The queue only ever shows printable work. |
| D5 | **Payload richness** | Push **address + line items + weight (when derivable)** so tickets/packing slips are complete and staff "just print." Weight falls back to staff entry in Starshipit when not derivable. |
| D6 | **Idempotency** | New nullable column **`orders.starshipit_pushed_at`** (migration owned by staff portal). Stamped on successful push, checked before every push. |
| D7 | **Cancel handling** | **Auto delete-on-cancel**, shipped as a fast-follow (P3) after the push paths are proven. |
| D8 | **Customer side / inbound webhook** | **Out of scope. Stays dark.** Customer tracking link, live status and dispatch email keep coming from Monday exactly as today. The inbound `webhooks/starshipit/route.ts` remains disabled (no `STARSHIPIT_WEBHOOK_SECRET`). |

## 3. Non-goals (explicit)

- No inbound tracking consumption (`order_shipments` Phase 3 bridge, customer display Phase 4, email cutover Phase 5). Those remain the *next* project, already designed in the staff-portal spec.
- No change to the Monday production/tracking pipeline or the customer-facing tracker.
- No staff-portal UI for Starshipit (staff use Starshipit's own web app, which they already do).

## 4. Current state (verified 2026-08-06)

- `print-room-portal/lib/starshipit/*` already contains a **complete but dark** integration: `config.ts`, `client.ts` (`POST /api/orders`), `eligibility.ts`, `push-order.ts`, plus the inbound `apply-webhook.ts` / `status.ts` / `verify-webhook.ts` (unused this build).
- Stock-on-hand push is already wired into `lib/checkout/submit.ts` step 5d behind `isStarshipitEnabled()` (inert while the flag is unset).
- **All four env vars are unset** (`STARSHIPIT_ENABLED`, `STARSHIPIT_API_KEY`, `STARSHIPIT_SUBSCRIPTION_KEY`, `STARSHIPIT_WEBHOOK_SECRET`); not in `.env.example`.
- Auth headers are correct per the live docs: `StarShipIT-Api-Key` + `Ocp-Apim-Subscription-Key`, base `https://api.starshipit.com`, rate limit 2 req/s.
- **The `POST /api/orders` request body and response path are the author's best guess and are flagged in-code as unverified** — this is the #1 risk (see §7).
- `pushOrderToStarshipit()` has **no idempotency guard** — fine for run-once checkout, unsafe for the repeatable Monday-webhook path.

## 5. Architecture

All code lives in `print-room-portal`. Two push paths share one client; the inbound path is untouched/dark.

| Path | Trigger | Entry point | Status |
|---|---|---|---|
| Stock-on-hand | Order placement | `lib/checkout/submit.ts` step 5d → `pushOrderToStarshipit()` | Built dark — verify payload, add idempotency, enable |
| Made-to-order | Monday production status = ready-to-dispatch | `app/api/webhooks/monday/tracker-status/route.ts` → new call to `pushOrderToStarshipit()` | **New** |
| Inbound tracking | Starshipit courier scans | `app/api/webhooks/starshipit/route.ts` | **Unchanged / dark** |

### 5.1 Shared client changes (`lib/starshipit/client.ts`)

- Correct the `POST /api/orders` payload to the **verified** field names (§7 output), and extend it to carry `items[]` and `weight` per D5.
- Harden response parsing to the verified success/id path.

### 5.2 Eligibility refactor (`lib/starshipit/eligibility.ts`)

Today it hard-codes stock-only (`not_stock_on_hand`). Generalise so the **trigger** decides the stock/production gate:

- **placement trigger** → require `isStockOnHand` (unchanged behaviour).
- **production-complete trigger** → do **not** require `isStockOnHand`; still require: enabled, not test-org, `intent === 'customer'`, delivery address present, and **not already pushed** (D6).

Add `already_pushed` to the ineligible-reason union; keep the existing reasons.

### 5.3 Idempotency (`orders.starshipit_pushed_at`)

- Migration in **staff portal** (schema owner): `ALTER TABLE orders ADD COLUMN starshipit_pushed_at timestamptz` (nullable).
- `pushOrderToStarshipit()` reads it before pushing (skip → `already_pushed`) and stamps it in the same transaction/step as the `ORDER_STARSHIPIT_PUSHED` audit event on success.

### 5.4 Made-to-order bridge (Monday webhook)

- In `tracker-status/route.ts`, after status is derived, detect the **ready-to-dispatch milestone** (exact Monday status label to be identified from `lib/monday/status-mappings.ts` / `lib/email/milestone-email.ts` — a planning task) and, in an `after()` block, call `pushOrderToStarshipit()` with the production-complete trigger.
- Resolve the Monday event → `orders` row via the existing job_tracker/quote linkage used elsewhere in the webhook.
- Best-effort and idempotent: failures audit `ORDER_STARSHIPIT_PUSH_FAILED`; the `starshipit_pushed_at` guard makes at-least-once redelivery safe.

### 5.5 Line-items + weight (D5)

- Build a mapper from order lines → Starshipit `items[]` (`description`, `sku`, `quantity`, `value`, optional `weight`).
- Derive order `weight` from product weight data when available; otherwise omit and let staff set it at print time. **Confirm in P0 whether weight is required for NZ Post label generation.**

### 5.6 Delete-on-cancel (P3, fast-follow)

- On portal order cancel, if `starshipit_pushed_at` is set, call Starshipit's delete/void order endpoint (endpoint + behaviour to be verified) and clear the stamp. Isolated so it can ship after P1/P2.

## 6. Data flow

**Stock-on-hand:** place order → `submitCustomerOrder` step 5d → eligible + not-yet-pushed → `POST /api/orders` (ref + address + items + weight) → stamp `starshipit_pushed_at` → unshipped in Starshipit queue → staff print ticket. *(Tracking still via Monday.)*

**Made-to-order:** place order → produced on Monday → status → ready-to-dispatch → Monday webhook → resolve order → not-yet-pushed → `POST /api/orders` → stamp → queue → staff print. *(Tracking still via Monday.)*

## 7. Risks & de-risking sequence

1. **🔴 `POST /api/orders` unverified.** Field names (`suburb`/`post_code`/`country` vs `city`/`postcode`/`country_code`), the `{ order: {...} }` envelope, `items[]`/`weight` schema, and the success/`order_id` response path must be confirmed against the live API. **P0 task:** test-push one clearly-marked **test order** into the real account, confirm it appears + prints, capture the true schema. Test artifacts → jamie@theprint-room.co.nz, never a live customer.
2. **🟠 Weight requirement** for NZ Post labels — confirm in the same P0 test (drives whether §5.5 weight is mandatory or optional).
3. **🟠 Idempotency** on the Monday path — covered by D6; must be in place *before* P2 ships.
4. **🟡 Account webhook config.** With inbound dark, ensure Starshipit's account-level tracking webhook is **not** pointed at the portal's dark endpoint (it would 401 on every scan). Leave it as-is / unset — a settings check, not code.
5. **🟡 Stale queue entries** on cancel/edit before P3 — accepted; staff delete manually until delete-on-cancel ships.
6. **🟢 Rate limit** 2 req/s — irrelevant at current volumes; batch `POST /api/orders/import` available later if needed.

## 8. Phased plan

- **P0 — Verify & prep (no customer impact):** test-push a test order; capture real `/api/orders` schema + response; confirm weight requirement; confirm/settle account webhook config; add the `starshipit_pushed_at` migration.
- **P1 — Enable stock-on-hand:** apply verified payload + items/weight to `client.ts`; add idempotency to `push-order.ts`; set env vars + `STARSHIPIT_ENABLED`; ship. Stock orders start flowing to the queue.
- **P2 — Made-to-order bridge:** identify the ready-to-dispatch Monday label; generalise eligibility (§5.2); add the push call in the Monday webhook; ship.
- **P3 — Delete-on-cancel (fast-follow):** verify Starshipit delete endpoint; wire to order cancel.

## 9. Test strategy

- Unit: `eligibility.ts` (both triggers, all reasons incl. `already_pushed`); items/weight mapper; idempotency guard (no double-push on repeat).
- Integration: stock-on-hand push at placement (mocked Starshipit); Monday-webhook made-to-order push (mocked); at-least-once redelivery does not double-register.
- Manual/live P0: one test order end-to-end into the real account, printed by staff.

## 10. Rollout & safety

- `STARSHIPIT_ENABLED` stays the master dark switch; every path no-ops while unset.
- Inbound webhook stays fail-closed (no secret) for the entire build.
- P1 and P2 ship independently behind the same flag; disabling the flag instantly halts all pushes with no customer-facing effect (customer side is 100% Monday-owned this build).

## P0 findings (2026-08-06)

Live test push against the real Print Room Dispatch account (`scripts/starshipit-test-push.mjs`, test order `PORTAL-TEST-20260805`, Starshipit `order_id` 740018611 — created, verified, deleted).

**Create (`POST /api/orders`) — payload CONFIRMED as coded. No changes needed.**
- HTTP 200; response is `{ order: {...}, success: true }`; the id lives at `order.order_id` (numeric) — exactly the path `createStarshipitOrder` parses.
- Every destination field name accepted and echoed verbatim: `name, email, phone, company, street, suburb, city, state, post_code, country`. `suburb` and `city` are distinct fields; sending the portal's single locality value in both worked (`address_validation: "Valid"`).
- `items[]` accepted with `description/quantity/value`; item `weight: 0` accepted — **no weight required at registration**.
- Order lands with `status: "Unshipped"` (D1 confirmed) and the account rules auto-assigned **CourierPost / NZ Post Domestic, service CPOLCT1** with no carrier field in the payload (D3 confirmed).
- **Weight (spec risk 2): resolved.** The account's default packaging ("AS COL - MED", 15 kg, 0.6×0.4×0.3 m) auto-populated the package, so orders arrive print-ready; staff adjust the package/weight at print time as they do today. No weight column, no payload weight.
- Defaults observed: `signature_required: true`, `currency: NZD`, address validated, `platform: "API"`.
- Gotcha (no impact): the `reference` field truncates at 50 chars. The portal payload doesn't send `reference` — `order_number` (= order_ref) carried fine.

**Delete (`DELETE /api/orders/delete?order_id={id}`) — CONFIRMED as coded.**
- HTTP 200, `{ "success": true }` — matches `deleteStarshipitOrder`'s success check. P3 delete-on-cancel is safe as built.

**Still open (HITL, non-blocking for merge/deploy while dark):**
1. Spec risk 4: in the Starshipit web app, Settings → Tracking & notifications — confirm the account webhook is NOT pointed at the portal's dark `/api/webhooks/starshipit` endpoint (leave whatever is there untouched). Do this before setting `STARSHIPIT_ENABLED`.
2. Optional confidence check: print (don't ship) a label for a future test entry to confirm the default-package weight satisfies NZ Post at print time.
