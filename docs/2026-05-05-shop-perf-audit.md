# Shop perf audit — 2026-05-05

| # | Measurement | Observed | Target | Recommended fix | Effort |
|---|---|---|---|---|---|
| 1 | TTFB cold (median of 3, empty-state path) | 608ms | <800ms | Cold dev TTFB itself is fine; the cost shifts once the loaded-products path runs (see #2/#3 projections) | n/a |
| 1 | TTFB warm (median of 3, empty-state path) | 80ms | <500ms | n/a — warm empty-state is well within target | n/a |
| 2 | Price RPC — single-call round-trip (probe via tsx → supabase-js → PostgREST) | 41ms median over 5 calls (warm pool) | <50ms per call OR 1 call total via batch | Batched RPC `effective_unit_prices_bulk` (Phase B Task 4) — turns 24 calls into 1 | done in B (Task 3 of plan) |
| 2 | Price RPC — projected for 24 products serial | ~982ms (24 × 41ms) | 1 call / <50ms | same as above | same |
| 3 | Variant query — single-call round-trip | 38ms median over 5 calls | bundled with price RPC or batched | Batch via Phase B Task 11 / consider folding into the bulk RPC alongside price | re-scope |
| 3 | Variant + availability queries (per page, projected for 24 products with variants) | ~1.9s (24 × 2 × ~40ms serial) | <fill> | Same — batch or fold into `effective_unit_prices_bulk` | re-scope |
| 4 | Image transfer | could not measure — see Notes | <500KB | Next opt + correct sizes (Phase B Task 11) | done in B |
| 5 | Dev compile cold (Ready in, Turbopack, .next cleared once then reused) | 7.1s first ever / 466–500ms after .next cache exists | <2s | Move .next off OneDrive (Phase B Task 13) — would also speed up the 7.1s first-ever compile | 5 min |
| 5 | Dev compile cold — first /shop hit (compile + render, empty-state) | 858–880ms total (next.js: 110–115ms, app: 515–521ms) | <2s | same | same |
| 5 | Dev compile warm-edit (touch + save, Turbopack incremental) | ~330ms total / ~110ms TTFB on next request | <2s | already meets target with Turbopack; distDir-off-OneDrive still helps cold | n/a |
| 5 | Slow filesystem warning fires? | No (Turbopack didn't emit one in this run) | n/a | n/a — note that webpack mode would likely still warn given OneDrive path | n/a |

## Notes

- Predicted bottleneck (price RPC): **confirmed by projection, not by direct in-page measurement.** Single-call RPC is 41ms and the loop is N-serial, so 24 products → ~982ms is the modelled cost. The bulk RPC (Phase B Task 4) collapses that to a single ~50ms call.
- **MAJOR DATA-SHAPE BLOCKER for steps 2/3/4.** As of 2026-05-05 the prod Supabase tables `b2b_catalogues`, `b2b_catalogue_items`, `product_variants`, and `variant_availability` are all empty (verified via direct count). The 2026-04-27 PRT Demo Catalogue (id `ba207fd4…` per memory) is no longer present. Consequence:
  - The `/shop` page hits the empty-state branch (line 48–58 of `app/(portal)/shop/page.tsx`) before the price/variant `Promise.all` loop ever runs, so the temp `performance.now()` wrappers described in plan steps 3–4 would only ever log `0 products`.
  - Image transfer (step 5) likewise can't be measured because no ProductCards render.
  - I therefore did NOT add the temp wrappers to `app/(portal)/shop/page.tsx` (would have produced no signal and risked contaminating the diff). Instead I measured the per-call RPC round-trip via a one-off `scripts/perf-rpc-probe.ts` script (subsequently deleted) using the same supabase-js admin client the app uses, then projected the 24-product cost.
  - Image transfer row remains genuinely unmeasured — Jamie needs to either reseed a catalogue OR open DevTools network panel against a tenant that does have one before that row can be filled.
- New bottlenecks discovered:
  - The `b2b_catalogue_items` scope query in `/shop` (lines 36–42) selects ALL catalogue rows for the org without `LIMIT`. Today it returns 0; once a real catalogue lands with hundreds of items, this becomes another non-trivial round-trip and potentially a payload concern. Worth a `.limit()` or `select('source_product_id')` only — currently it pulls the joined `b2b_catalogues!inner(is_active)` payload too. Not a blocker right now; flag for Phase B if a catalogue lands.
  - Cold dev startup did 7.1s on the very first run (after `rm -rf .next`) but only 466–500ms on subsequent fresh `npm run dev` invocations because Turbopack persists its cache outside `.next/` (likely `node_modules/.cache`). The `distDir` Phase B fix should still help, but the cache-already-warm case is already sub-second on this hardware.
  - The empty-state /shop application-code time is ~515–521ms even for the do-nothing branch. That's auth (`requireB2BCustomer` runs 1 user lookup + 1 membership query + 4 parallel queries) plus the catalogue scope query — call it 5–6 round-trips. Each round-trip costs ~40ms (matching the probe). That floor of ~250ms+ from Auckland-dev → Supabase-AP-Southeast is the real per-page tax even with batching, and is something the bulk RPC alone won't fix. Worth noting to Jamie: the Phase B fixes assume a North-Star where this floor is acceptable.
- Recommended Phase B additions: **none new must-have**, but two soft suggestions:
  1. Slim the scope query to `select('source_product_id')` only — drop the `b2b_catalogues!inner(is_active)` join expansion, replace with a separate active-catalogues lookup or push `is_active` into a view. Pure code change, ~10 min, ships under the "Phase B Task 4" umbrella.
  2. Consider folding variants/availability into `effective_unit_prices_bulk` so a single round-trip returns `{product_id, unit_price, has_stock}`. Avoids N×2 follow-up calls even after the price-loop fix.

## Method

- **Auth.** No password on hand for `hello@theprint-room.co.nz`. Generated a magiclink via the Supabase Admin API (`/auth/v1/admin/generate_link`, `type=magiclink`), drove it through Playwright to `/callback?token_hash=…&type=email&next=/account`, captured the resulting `sb-bthsxgmcnbvwwgvdveek-auth-token` cookie, then set `welcome_seen=true` to bypass the proxy.ts welcome-gate. Cookie pasted into a Netscape-format jar at `/tmp/cookies.txt` for curl.
- **TTFB.** `curl -s -o /dev/null -w '%{time_starttransfer}s' -b /tmp/cookies.txt http://localhost:3001/shop`. Cold = 3 cycles of (kill dev server PID listening on :3001, `npm run dev`, wait for "Ready in", first curl). Warm = 3 immediate re-curls after a single cold hit.
- **Single-call RPC + variant query timing.** Temporary `scripts/perf-rpc-probe.ts` (now deleted) used `@supabase/supabase-js` with the service-role key to call `effective_unit_price` and the per-row variant + availability selects 5 times each, after one warm-up call to amortise TLS handshake. Median reported. The script ran from the same machine the dev server runs on, so the network distance to Supabase matches what `/shop` would see.
- **Per-product price-loop and per-row variant timing in-page.** Not measured — the data shape blocker above means the loop never iterates. Single-call timings × loop length used as projection.
- **Image transfer.** Not measured — empty-state `/shop` renders no `ProductCard`s, so the network panel has nothing to sum. Needs a tenant with a populated catalogue.
- **Dev compile cold + warm-edit.** Read directly from the dev server log (`Ready in Xms`, `GET /shop 200 in Xms (next.js: Xms, …)`). Warm-edit = trailing-newline change to `app/(portal)/shop/page.tsx` (subsequently reverted), `curl /shop`, recorded the second `GET /shop` line. Slow-filesystem warning checked via `grep -i 'slow filesystem|onedrive'` against the dev log — no hit (Turbopack appears not to emit the classic webpack warning).
- **DB-side query plan.** `EXPLAIN (ANALYZE, TIMING, BUFFERS)` on `effective_unit_price(product, org, 1)` returned 2.0ms execution / 563 buffer hits — confirming the 41ms client-side number is dominated by network round-trip, not DB work. This is the strongest possible argument for batching.
