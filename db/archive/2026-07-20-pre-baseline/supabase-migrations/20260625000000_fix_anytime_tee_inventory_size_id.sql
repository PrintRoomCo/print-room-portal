-- Fix: the Anytime Fitness tee could not be ordered while the hood could.
--
-- `variant_availability` is a thin view over `variant_inventory` and exposes
-- `variant_inventory.size_id` verbatim. The PDP loader and ProductDetailClient
-- key availability on `${variant_id}::${size_id}` using the VARIANT's size_id,
-- so an inventory row whose `size_id` is NULL (while its variant carries a real
-- size_id) is stored under a different key than the client reads -> the size
-- resolves as untracked -> not orderable. The hood worked only because its
-- inventory rows already carried the matching `size_id`.
--
-- Align each affected inventory row's `size_id` to its variant's `size_id` (the
-- hood pattern). Idempotent: re-running updates 0 rows. `size_id` is not part of
-- the (variant_id, organization_id) unique key, so this is constraint-safe.
--
-- Scoped to the Anytime Fitness org + tee product (the live customer bug). The
-- same NULL-size pattern also exists on the internal "Test Account" org (19
-- rows) and can be corrected separately if desired.
update variant_inventory vi
set size_id = pv.size_id, updated_at = now()
from product_variants pv
where vi.variant_id = pv.id
  and pv.product_id = 'ac0c6687-87ac-445e-bb89-35a838485bca'      -- Anytime Fitness tee
  and vi.organization_id = '6c65151e-fbd8-49f3-9b66-5e7dd0e13436' -- Anytime Fitness
  and pv.size_id is not null
  and vi.size_id is distinct from pv.size_id;
