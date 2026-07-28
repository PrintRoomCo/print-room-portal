-- =====================================================================
-- D1: Batched (set-returning) decoration-price RPCs for the catalogue grid
-- =====================================================================
-- Purpose:
--   The catalogue grid resolves decoration prices by calling two SCALAR
--   RPCs once per (id, band):
--     * effective_decoration_unit_price(p_org_decoration_id, p_qty)
--     * catalogue_item_decoration_price(p_catalogue_item_id, p_qty)
--   Even after the client-side dedupe (commit d648000 — unique decoration
--   x 2 bands), that is still 2*(unique_decorations + manual_items) separate
--   PostgREST round-trips per page render. Against the remote Supabase project
--   each round-trip is ~one network RTT; this wave measured ~122 ms.
--
--   These two wrappers let the client resolve the whole overlay in ONE
--   round-trip per source: pass a JSON array of {id, qty} pairs, get back one
--   row per pair. Each wrapper simply calls the EXISTING scalar function per
--   element, so the returned price is byte-identical to the current path by
--   construction — no pricing logic is duplicated or re-implemented here.
--
-- Date: 2026-07-28
-- Project ref: bthsxgmcnbvwwgvdveek
--
-- *** SCHEMA OWNERSHIP ***
--   print-room-portal does NOT own this database's schema (see
--   supabase/migrations/README.md). print-room-staff-portal owns it. This file
--   is a DRAFT for review only. To apply: move it into
--   print-room-staff-portal/supabase/migrations/ as a timestamped migration and
--   apply it from THERE (never via the dashboard or MCP apply_migration).
--
-- *** STAGED FOR REVIEW — DO NOT APPLY without explicit sign-off. ***
--   These are pure CREATE OR REPLACE FUNCTION statements (no table DDL, no
--   locks, transaction-safe) and are ADDITIVE — they introduce two new
--   functions and do not alter the existing scalar RPCs. The client
--   (lib/shop/catalogue-decoration-prices.ts) falls back to the scalar path
--   when these functions are absent, so the app is safe both before and after
--   this migration is applied (feature-dark until present).
--
-- Equivalence verified read-only against production data on 2026-07-28:
--   effective_decoration_unit_prices_bulk vs scalar  -> 0 mismatches
--   catalogue_item_decoration_prices_bulk vs scalar  -> 0/120 mismatches
--   empty array -> 0 rows (no error); unknown id -> NULL (matches scalar).
--   (The verification query is reproduced in the comment block at the end.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. effective_decoration_unit_prices_bulk
--    Batched form of effective_decoration_unit_price. One row per input
--    {org_decoration_id, qty}; unit_price is exactly what the scalar returns
--    (including NULL for not-found / unpriced decorations, which the client
--    maps to its org_decorations.unit_price fallback — unchanged).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_decoration_unit_prices_bulk(p_items jsonb)
RETURNS TABLE(org_decoration_id uuid, qty integer, unit_price numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    (elem->>'org_decoration_id')::uuid AS org_decoration_id,
    (elem->>'qty')::int                AS qty,
    public.effective_decoration_unit_price(
      (elem->>'org_decoration_id')::uuid,
      (elem->>'qty')::int
    )                                  AS unit_price
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS elem;
$function$;

-- Mirror the scalar's grants: authenticated + service_role, NOT anon.
REVOKE ALL ON FUNCTION public.effective_decoration_unit_prices_bulk(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_decoration_unit_prices_bulk(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_decoration_unit_prices_bulk(jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 2. catalogue_item_decoration_prices_bulk
--    Batched form of catalogue_item_decoration_price. One row per input
--    {catalogue_item_id, qty}; unit_price is exactly what the scalar returns
--    (NULL for non-manual items, per the scalar's own guard).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalogue_item_decoration_prices_bulk(p_items jsonb)
RETURNS TABLE(catalogue_item_id uuid, qty integer, unit_price numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    (elem->>'catalogue_item_id')::uuid AS catalogue_item_id,
    (elem->>'qty')::int                AS qty,
    public.catalogue_item_decoration_price(
      (elem->>'catalogue_item_id')::uuid,
      (elem->>'qty')::int
    )                                  AS unit_price
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS elem;
$function$;

-- Mirror the scalar's grants: anon + authenticated + service_role.
REVOKE ALL ON FUNCTION public.catalogue_item_decoration_prices_bulk(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalogue_item_decoration_prices_bulk(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.catalogue_item_decoration_prices_bulk(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogue_item_decoration_prices_bulk(jsonb) TO service_role;

-- =====================================================================
-- Post-apply verification (read-only; run in the SQL editor after applying).
-- Expect mismatches = 0 for both. Compares the new bulk functions against the
-- scalar functions row-for-row over real data.
-- =====================================================================
-- WITH sample_decos AS (
--   SELECT od.id, q.qty
--   FROM org_decorations od
--   CROSS JOIN (VALUES (1),(12),(24),(50),(100),(1000)) q(qty)
--   WHERE od.id IN (
--     SELECT DISTINCT cid.org_decoration_id
--     FROM b2b_catalogue_item_decorations cid
--     JOIN b2b_catalogue_items ci ON ci.id = cid.catalogue_item_id
--     WHERE cid.org_decoration_id IS NOT NULL
--       AND ci.price_mode IS DISTINCT FROM 'manual_final'
--   )
-- ),
-- bulk AS (
--   SELECT * FROM public.effective_decoration_unit_prices_bulk(
--     (SELECT jsonb_agg(jsonb_build_object('org_decoration_id', id, 'qty', qty)) FROM sample_decos)
--   )
-- )
-- SELECT count(*) FILTER (
--   WHERE b.unit_price IS DISTINCT FROM public.effective_decoration_unit_price(s.id, s.qty)
-- ) AS mismatches
-- FROM sample_decos s JOIN bulk b ON b.org_decoration_id = s.id AND b.qty = s.qty;
-- =====================================================================
