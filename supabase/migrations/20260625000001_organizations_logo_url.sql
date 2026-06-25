-- Org-uploadable header logo.
-- Nullable; null means the org falls back to the Print Room mark in the header.
alter table organizations
  add column if not exists logo_url text;
