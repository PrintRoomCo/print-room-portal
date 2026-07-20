-- Checkout billed-total parity (spec 2026-07-17). The customer-facing invoice
-- figures, snapshotted at submit so the confirmation page and the customer email
-- render what was actually billed rather than recomputing against today's
-- variant_inventory.billing_mode — which is mutable, so a recompute would
-- silently rewrite the history of an old order.
--
-- total_amount is deliberately UNCHANGED: it stays the ex-GST GOODS value, so
-- Monday pushes, staff order views and reporting are untouched by this work.
--
-- picking_fee  — the NZ picking fee charged on this order, ex-GST. 0 when none
--                applies (purchase order, non-NZ ship-to).
-- billed_total — ex-GST total actually invoiced: billed goods + picking_fee.
--                Prepaid stock draws contribute 0 goods, so a wholly prepaid
--                order's billed_total is just the picking fee.
--
-- Both nullable: NULL means "order predates this column", which readers must
-- distinguish from 0 (a real, free order).
alter table public.quotes
  add column if not exists picking_fee numeric,
  add column if not exists billed_total numeric;

comment on column public.quotes.picking_fee is
  'NZ picking fee charged on this order, ex-GST. 0 = no fee applies. NULL = order predates the column.';
comment on column public.quotes.billed_total is
  'Ex-GST total actually invoiced: billed goods (prepaid draws count 0) + picking_fee. Distinct from total_amount, which stays the full goods value. NULL = order predates the column.';
