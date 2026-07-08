# Demo Org — Subagent-Driven Execution Progress

Plan: print-room-portal/docs/superpowers/plans/2026-07-08-demo-org.md
Branch: `demo-org` in BOTH repos (print-room-staff-portal @ from master, print-room-portal @ from main)
Shared DEMO_PASSWORD: saved in scratchpad/demo-password.txt (value used across staff .env.local, portal .env.local, GH/Vercel secrets)
Supabase project: bthsxgmcnbvwwgvdveek (LIVE, shared) — verification via mcp__supabase__execute_sql

## Task status
- [ ] A1: Scaffolding (config, client, helpers, logo asset, dry-run) — staff-portal
- [ ] A2: Identity & tenancy — staff-portal
- [ ] A3: Catalogue, pricing copy, colours, images — staff-portal
- [ ] A4: Artwork upload + left-chest decoration on tee & hood — staff-portal
- [ ] A5: Inventory (mixed in/low/out) — staff-portal
- [ ] A6: Nightly reset (purge + restock) wired into seed — staff-portal
- [ ] A7: GitHub Actions nightly schedule — staff-portal (YAML automatable; secrets+dispatch MANUAL)
- [ ] B1: order-email-recipient helper (TDD) — portal
- [ ] B2: wire email guard into submit.ts — portal
- [ ] B3: /api/demo/enter route — portal (code automatable; .env.local + browser test MANUAL)
- [ ] B4: Explore-the-demo button — portal (code automatable; browser test MANUAL)
- [ ] B5: Deploy env + e2e — MANUAL (Vercel env, live order/email/Monday) — hand off to user

## Manual tail (external systems — cannot be done by subagents)
- A7: add GH repo secrets + run workflow dispatch
- B3/B4: create portal .env.local (DEMO_EMAIL, DEMO_PASSWORD), run dev, browser-verify
- B5: Vercel env vars + full sandbox order (sends real email to jamie@, creates Monday deal)

## Completed
(none yet)
