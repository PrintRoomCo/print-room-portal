# Demo Org — Design Spec

**Date:** 2026-07-07
**Target app:** `print-room-portal` (B2B customer portal), with provisioning + a nightly job in `print-room-staff-portal`
**Status:** Draft for review (brainstorming output — not yet planned or built)

---

## 1. Goal

Create a single, always-available **demo organisation** that anyone can drop into with **one click** and experience the portal end-to-end as a realistic `studio_plus_inventory` customer: browse a curated catalogue, see a garment decorated with the **Print Room logo on the left chest**, watch **real Print Room quantity-break pricing**, draw down **live inventory**, and place an order that goes **all the way through checkout but is fully sandboxed** (no production Monday/Xero, no customer emails, auto-reset nightly).

The boss's chosen shape is "a demo org login" (vs. guest/sandbox alternatives). This spec delivers that with a frictionless one-click entry.

## 2. Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Demo journey depth | **Full flow, sandboxed** — order can be placed; side-effects suppressed |
| Entry | **One-click "Explore demo"** button (no credentials typed) |
| Catalogue breadth | **Tee + hood + a few stocked extras** (~5 items) |
| Logo source | **`printroom_primary_logo.svg`** (primary navy wordmark), located in-repo |
| Build method | **Idempotent seed script** (service-role, re-runnable to reset) |
| Decoration method | **Screenprint** (1-colour left chest) |
| Concurrency | **Shared demo account + nightly reset** (accept shared cart for now) |
| Tenant type | **`studio_plus_inventory`** (first org of this type — a genuine showcase) |
| Pricing | **Print Room master pricing**, Tier 1 (0.95×) |

## 3. Reference model — what Anytime Fitness has

Anytime Fitness (`org 6c65151e-fbd8-49f3-9b66-5e7dd0e13436`) is the closest existing template, though it's `franchise` (65 stores, 66 members). The demo mirrors its *structure* at *studio scale*:

- `organizations` + `b2b_accounts` (tenant_type, pricing_mode=tier, Tier 1 = `62745b6a-eb8b-430b-a795-491f2315a21a`)
- One `b2b_catalogues` → 15 `b2b_catalogue_items` (all AS Colour / Made-to-Order), `price_mode=manual_final`
- `b2b_catalogue_item_pricing_tiers` quantity ladders (1–23, 24–49, 50–99, 100–249, 250–499, …)
- `organization_artworks` "Left Chest Supacolour" (PNG in `org-artworks` bucket) → `org_decorations` "front placement" (80×60mm) → linked to items via `b2b_catalogue_item_decorations` (`is_default`, `is_published`)
- `variant_inventory` (50 rows) + `stores` (one per gym)

## 4. Architecture — the demo org graph

```
organizations (name "Print Room Demo", customer_code DEMO, is_test=TRUE, logo_url=<PR logo>)
 └─ b2b_accounts (tenant_type=studio_plus_inventory, pricing_mode=tier, customer_tier_id=Tier1, account_manager=<existing AM>)
 └─ stores ["Print Room Demo Studio"]  ← default_store_id for the demo member
 └─ b2b_catalogues "Print Room Demo — Studio Collection"
 │   └─ b2b_catalogue_items ×5  (source_product_id → products)
 │        ├─ b2b_catalogue_item_pricing_tiers   (copied from master product_pricing_tiers = PR pricing)
 │        ├─ b2b_catalogue_item_colors          (navy/black/white so the navy mark reads)
 │        ├─ b2b_catalogue_item_images          (reuse published product_images + card image)
 │        └─ b2b_catalogue_item_decorations     (tee + hood: default + published, left-chest placement)
 ├─ organization_artworks "Print Room — Left Chest"  (printroom_primary_logo.svg → org-artworks bucket)
 │   └─ org_decorations "Print Room — Left Chest" (method=screenprint, ~80×58mm, unit_price=<flat 1-col rate>)
 ├─ variant_inventory  (a few sizes each; some in-stock, one low/out to show stock states)
 └─ user_organizations  (1 shared demo member: role, default_store_id=demo store, ordering_permission=both, UNIQUE demo email)
```

## 5. Component specs

### 5.1 Identity & tenancy
- `organizations`: `name="Print Room Demo"`, `customer_code="DEMO"`, **`is_test=true`**, `logo_url=<public URL of uploaded PR logo>`. `domain` left null.
- `b2b_accounts`: `tenant_type='studio_plus_inventory'`, `pricing_mode='tier'`, `customer_tier_id=62745b6a-…` (Tier 1, 0.95×), `payment_terms='net30'`, `is_active=true`, `account_manager_id=<existing AM — confirm which; Anytime's is 0be98ec9-90dc-4f4e-b751-c725e059ac4f>`.
- **Unique demo email** (e.g. `demo@theprint-room.co.nz`) — mandatory to avoid the documented cross-tenant tracker/order leak (see §7).

### 5.2 Catalogue
Catalogue `"Print Room Demo — Studio Collection"`. Items (source product IDs confirmed present, richly imaged):

| Item | `source_product_id` | Base | 1–23 (PR price) | Decoration |
|---|---|---|---|---|
| Classic Tee (AS Colour) | `40819426-320f-4edb-a18d-a0099fc2f974` | $9.50 | $42.22 | ⭐ left-chest logo |
| Stencil Hood (AS Colour) | `232b839b-eb86-4c56-8705-da4656c171c2` | $28.95 | $70.28 | ⭐ left-chest logo |
| Access Faded Cap | `8b6f9780-97ab-4354-ad29-f410c487fcd4` | — | $30.76 | (stocked, plain) |
| Recycled Light Duffel | `6212f5a2-0e5c-41f3-a3b7-213c95f204af` | — | $32.12 | (stocked, plain) |
| Claremont Drink Bottle | `54bffa8a-97ad-4ede-af1d-f796a273ebdb` | — | $27.52 | (stocked, plain) |

- **Pricing:** copy master `product_pricing_tiers` → `b2b_catalogue_item_pricing_tiers` (this is the canonical "Print Room pricing"); `price_mode='manual_final'`. Tier 1 multiplier applies on top.
- **Colours:** seed a few per garment (white/black/navy) so the navy logo is legible; mark one default.
- **Images:** reuse existing published `product_images`; set a `card_image_id` per item.

### 5.3 Decoration + artwork (the hero)
- **Artwork:** upload `print-room-studio/public/as-colour-reference-images/printroom_primary_logo.svg` (navy `#2b3990`, ~1.37:1) to the **`org-artworks`** bucket → `organization_artworks` "Print Room — Left Chest". Keep PNG (`print-room-portal/public/print-room-logo.png`, 332×243) as raster fallback.
- **Decoration:** `org_decorations` name "Print Room — Left Chest", **`decoration_method='screenprint'`**, `width_mm≈80`, `height_mm≈58`, `colour_count=1`, `artwork_id=<above>`, **`unit_price=<flat 1-colour left-chest rate>`**.
- **Link:** `b2b_catalogue_item_decorations` on **tee + hood only** (per the explicit ask): `is_default=true`, `is_published=true`, placement (`placement_x/y/w/h`) anchored to the front image's left-chest print area. Accessories stay plain.
- ⚠️ **Pricing caveat (must verify):** the `screenprint_*` tables (`screenprint_pricing_tiers`, `screenprint_rules_v1`, `screenprint_base_rates`, …) are **currently empty**. The catalogue grid computes decoration price via RPC `effective_decoration_unit_price` / `catalogue_item_decoration_price`. If those RPCs return $0 for screenprint with empty tables, use the **explicit `org_decorations.unit_price`** (or `unit_price_override` on the link) as the effective price — the decorations lib already does `COALESCE(link.unit_price_override, decoration.unit_price)`. Alternatively seed a minimal `screenprint_pricing_tiers` row. **Confirm the grid shows a non-zero, realistic left-chest price before sign-off.**

### 5.4 Inventory (the studio_plus_inventory showcase)
- One `stores` row: "Print Room Demo Studio".
- Seed `variant_inventory` for a handful of sizes per item: most **in stock**, one **low** (near `reorder_point`), one **out** — so live stock chips and the `/inventory` page (both gated to inventory tenants) demonstrate real states. Note: `studio_plus_inventory` also unlocks `allowsMultiStoreOrdering`, but with a single demo store that UI is present-but-trivial; adding more stores is out of scope (§10).

### 5.5 Access — one-click "Explore demo"
- **One shared demo member** in `user_organizations` (role **`staff`** — mirrors a real store member's view rather than an admin's; `staff` requires a `default_store_id`, which we set to the demo store; `ordering_permission='both'`; the unique demo email). Note: `getCompanyAccess()` uses `.single()` — exactly one membership per user, so the demo user maps cleanly to the demo org.
- **Entry route** (`print-room-portal`): a public `app/api/demo/enter/route.ts` that server-side `signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD })` (both from env), sets the SSR session cookies, and redirects → `/welcome` (first-visit gate in `proxy.ts`) → `/catalogue`.
- **Button:** "Explore the demo" on `app/(auth)/sign-in/SignInClient.tsx`, hitting that route. (Password mode is required because a shared OTP-code login can't deliver the code to anonymous visitors.)
- **Secrets:** `DEMO_EMAIL` / `DEMO_PASSWORD` in Vercel env (Production + Preview). The password is effectively public (anyone can click in) — that's acceptable *because* the account is sandboxed and reset nightly.

### 5.6 Sandboxing (full-flow, no real-world side effects)
- **Already wired via `is_test=true`:** Monday.com push routed to the demo group (`MONDAY_PRODUCTION_DEMO_GROUP_ID`, `lib/monday/deal-item.ts`), Xero invoicing skipped (`lib/xero/eligibility.ts`).
- **Emails:** confirm current order-email behavior in `lib/checkout/submit.ts`; for `is_test` orgs, **route order/confirmation emails to `jamie@theprint-room.co.nz`** (per standing rule: test emails go to jamie@, never jon@) **or suppress** them. Add a guard if not already present.
- **Nightly reset job** (`print-room-staff-portal`, cron): scoped strictly to the demo `organization_id`, delete demo `orders` / `quotes` / `quote_items` / `carts` / `cart_items` / `job_trackers` and **restock `variant_inventory`** to seed levels. Keeps the demo pristine and bounds data growth. Idempotent with the seed script.

## 6. Build approach — idempotent seed script

- **Location:** `print-room-staff-portal/scripts/demo-org/` (sibling to `scripts/shopify-orders-port/`, which is the working template for programmatic org/catalogue/item/price creation via the service-role key).
- **Idempotency:** upsert by stable natural keys (`organizations.customer_code='DEMO'`, catalogue name, item `source_product_id`, decoration name, store name, member email). Re-running **reconciles to spec** rather than duplicating — this doubles as the "reset to factory" tool.
- **Steps (mirrors the canonical provisioning order):**
  1. Upsert `organizations` (+`is_test`) and `b2b_accounts` (tenant_type, tier, AM).
  2. Upsert `stores` (demo studio).
  3. Upsert `b2b_catalogues` + `b2b_catalogue_items`; copy master `product_pricing_tiers` → item tiers; set colours, images, card image.
  4. Upload logo → `org-artworks`; upsert `organization_artworks` + `org_decorations` (screenprint, flat price); link to tee/hood via `b2b_catalogue_item_decorations` (default + published) with left-chest placement.
  5. Seed `variant_inventory` (mixed stock states).
  6. Upsert the shared demo `user_organizations` member (unique email; create auth user via `auth.admin.createUser` if absent; set the shared password).
  7. Print a summary + the demo entry URL.
- **Portal changes (separate, small):** the `/api/demo/enter` route + sign-in button + email-routing guard.

## 7. Security & isolation

- **Cross-tenant leak (documented):** `docs/security/2026-07-01-cross-tenant-data-isolation-audit.md` — job-tracker/order visibility falls back to **email matching** when `company_id`/`location_id`/`user_id` are unset. Mitigations (mandatory): unique demo email; ensure every demo `job_trackers`/`orders` row carries `organization_id` + `user_id`; never reuse a real customer's email for the demo account.
- **Shared credential:** acceptable only because the org is `is_test`, sandboxed, and nightly-reset. Do not grant the demo member any staff/admin capability beyond ordering within its own org.
- **RLS:** all *production* tables have RLS enabled. (The 94 RLS-disabled tables flagged by the advisor are all `_bak_`/backup/staging — out of scope here; a separate cleanup could drop old backups and clear the warning.)

## 8. Open questions / verification items

1. **Screenprint price rendering** — confirm the catalogue grid shows the intended non-zero left-chest price given empty `screenprint_*` tables (§5.3). Decide: explicit `unit_price` vs. seed minimal screenprint tiers.
2. **Exact left-chest 1-colour price** — what flat rate should the demo show? (Placeholder until confirmed.)
3. **Order-email behavior for `is_test`** — verify whether emails already suppress; if not, implement jamie@ routing.
4. **Account manager** — which existing AM to attach (reuse Anytime's, or a dedicated demo AM?).
5. **Demo org display name** — "Print Room Demo" acceptable, or a more prospect-facing name (e.g. "The Studio — Demo")?
6. **Colours/sizes to seed** per item (proposed: white/black/navy; S–XL).

## 9. Success criteria

- From the sign-in page, one click lands an anonymous visitor in the demo org at `/catalogue`, no credentials typed.
- Tee and hood display the Print Room left-chest logo mockup and a **non-zero, realistic** decorated price with correct quantity-break tiers.
- Inventory page + stock chips show real, varied stock states.
- A full checkout completes; **no** production Monday card, **no** Xero invoice, **no** customer email to a real address.
- Re-running the seed script (or the nightly job) restores the demo to its pristine seed state with no duplicates.

## 10. Out of scope (YAGNI)

- Per-visitor ephemeral users (revisit only if public traffic causes cart collisions).
- A live customer-facing design canvas (the designer lives in the staff portal; demo uses pre-configured decorations).
- Multiple demo stores / multi-region inventory (one store is enough to show the feature).
- Dropping the legacy `_bak_` tables / RLS cleanup (separate housekeeping task).
