-- 2026-05-21 — Checkout → Monday CRM Deals push.
-- Stores the Monday Deals board item id created at customer checkout. Distinct
-- from quotes.monday_item_id which holds (legacy) Production board item ids
-- and becomes vestigial after Stage 4 retires the AM-approve gate.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS monday_item_id text;
