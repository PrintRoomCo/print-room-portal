-- Portal-owned Starshipit webhook log. Mirrors the studio schema
-- (print-room-studio/sql/010-create-starshipit-webhook-logs.sql). IF NOT EXISTS
-- because portal + studio share one Supabase project and the table ALREADY
-- EXISTS from the studio integration (verified 2026-07-16 — identical columns),
-- so this migration is an idempotent record-keeper: it documents the portal's
-- dependency on the table without re-creating it.
create table if not exists public.starshipit_webhook_logs (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  tracking_number text,
  tracking_status text,
  carrier_name text,
  carrier_service text,
  payload jsonb,
  matched_job_tracker_id bigint,
  status text not null default 'received',
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_starshipit_webhook_logs_order
  on public.starshipit_webhook_logs (order_number);
create index if not exists idx_starshipit_webhook_logs_tracking
  on public.starshipit_webhook_logs (tracking_number);
