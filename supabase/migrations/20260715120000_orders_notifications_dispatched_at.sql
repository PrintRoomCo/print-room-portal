-- Guard column for checkout post-commit side-effects. Set exactly once (atomic
-- compare-and-set) when the deferred Monday/Xero/email/Slack work is dispatched,
-- so a replay (same idempotency_key) or a concurrent double-submit cannot
-- re-send. Nullable; NULL = not yet dispatched. Additive + backward-compatible:
-- the staff portal neither reads nor writes it.
alter table public.orders
  add column if not exists notifications_dispatched_at timestamptz;

comment on column public.orders.notifications_dispatched_at is
  'Checkout side-effect dispatch guard: set once when Monday/Xero/emails/Slack are dispatched; NULL = pending. Compare-and-set prevents duplicate sends on replay/double-submit.';
