-- 2026-07-15 — Foundation F-1: order-type classification.
-- Every order is typed as either a stock-on-hand draw (all lines fulfilled from
-- existing inventory) or a purchase order (anything made to order). submit
-- (lib/checkout/submit.ts) stamps this from the cart's per-line fulfilment_type
-- via classifyOrderType(); interim rule — a mixed cart is one order classified
-- 'purchase_order' (Spec B F1 will split mixed carts). Downstream readers
-- (Past-orders list, invoicing, dispatch: Items 10/11/13/15) branch on this.
--
-- text + CHECK (not a native enum type) mirrors the newest precedent on this
-- table, orders.xero_invoice_status (20260702120000), and keeps the value set
-- easy to extend in Spec B without an ALTER TYPE.

alter table public.orders
  add column if not exists order_type text not null default 'purchase_order';

alter table public.orders
  drop constraint if exists orders_order_type_check;
alter table public.orders
  add constraint orders_order_type_check
  check (order_type in ('stock_on_hand', 'purchase_order'));

comment on column public.orders.order_type is
  'stock_on_hand (every line drawn from existing inventory) | purchase_order '
  '(any made-to-order line). Stamped at submit by classifyOrderType(). Interim: '
  'a mixed cart is one order classified purchase_order (Spec B F1 will split).';
