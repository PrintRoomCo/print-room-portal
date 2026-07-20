-- Keep org_admin ordering_permission honest at the data layer.
--
-- org_admins are ALWAYS unrestricted ('both') by role — effectivePermission()
-- in lib/shop/fulfilment-mode.ts enforces this at read time, so the stored
-- user_organizations.ordering_permission is irrelevant to what an admin may DO.
-- But the column DEFAULT is 'stock_only', so admin rows are typically created
-- (e.g. by the staff portal) holding a stale 'stock_only'. That stale value is
-- harmless for checkout now that the read path overrides it, yet it is shown
-- verbatim in the staff-portal members list, where an admin misleadingly reads
-- "stock only".
--
-- This migration makes the stored data match the in-force semantics:
--   1. a one-time backfill of existing org_admin rows to 'both', and
--   2. a BEFORE INSERT/UPDATE trigger that normalises any org_admin row to
--      'both', so future rows (from any writer, including the separate staff
--      portal) stay clean without an app-code change.
-- Staff rows are left untouched — their stored permission is authoritative.

-- 1. Backfill existing admin rows.
update user_organizations
set ordering_permission = 'both'
where role = 'org_admin'
  and ordering_permission is distinct from 'both';

-- 2. Keep admin rows normalised going forward.
create or replace function normalise_admin_ordering_permission()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'org_admin' then
    new.ordering_permission := 'both';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalise_admin_ordering_permission on user_organizations;
create trigger trg_normalise_admin_ordering_permission
  before insert or update on user_organizations
  for each row
  execute function normalise_admin_ordering_permission();
