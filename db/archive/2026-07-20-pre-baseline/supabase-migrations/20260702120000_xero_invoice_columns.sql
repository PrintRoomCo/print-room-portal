-- Xero draft-invoice integration (Initiative 1).
-- organizations: cache the resolved Xero ContactID so we never re-resolve per order.
-- orders: record the draft's Xero ids + a lifecycle status for the manual-review flag.

alter table public.organizations
  add column if not exists xero_contact_id text;

alter table public.orders
  add column if not exists xero_invoice_id text,
  add column if not exists xero_invoice_number text,
  add column if not exists xero_invoice_status text;

-- Allowed statuses: drafted (auto-created in Xero), manual_review (flagged for
-- Charlotte), skipped (deliberately not drafted — e.g. test org). NULL = not yet
-- evaluated / feature was off at submit.
alter table public.orders
  drop constraint if exists orders_xero_invoice_status_check;
alter table public.orders
  add constraint orders_xero_invoice_status_check
  check (xero_invoice_status is null
         or xero_invoice_status in ('drafted', 'manual_review', 'skipped'));

comment on column public.organizations.xero_contact_id is
  'Cached Xero ContactID for this org (billing entity). Set on first draft.';
comment on column public.orders.xero_invoice_status is
  'drafted | manual_review | skipped | null. Source of truth for the manual-invoice flag.';
