-- 2026-05-21 — Checkout → Monday → Auto-Proof pipeline.
-- Extend the order_status enum to include the two new states introduced by
-- retiring the AM-approve gate. Existing values stay legal (this is additive).
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting-proof-review';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting-customer-approval';
