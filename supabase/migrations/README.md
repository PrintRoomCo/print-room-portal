# This repo does NOT own the database schema

`print-room-portal` and `print-room-staff-portal` share **one** Supabase project
(`bthsxgmcnbvwwgvdveek`). To avoid two sources of truth for one database, exactly
one repo owns the schema:

## ➡️ `print-room-staff-portal` owns the schema.

**Do not add migration files here.** This directory is intentionally empty. All
schema changes — for either app — are authored and applied from
`print-room-staff-portal/supabase/migrations/`.

### If you need a schema change for the customer portal

1. Make the change as a migration file in **`print-room-staff-portal`**
   (`supabase/migrations/`), and apply it from there.
2. Regenerate types if needed and pull them into this repo.

### Rule

Never apply schema directly via the Supabase dashboard or MCP `apply_migration`
from any repo — that is what caused the drift this reconciliation fixed (2026-07-20).
Schema changes are written as a file and applied from the file, in the owner repo.

The 11 migration files this repo previously held were applied long ago (their
effects are captured in the owner repo's baseline) and are archived under
`db/archive/2026-07-20-pre-baseline/` for provenance.
