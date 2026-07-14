-- ============================================================================
-- B1 — Trim the supabase_realtime publication to tables actually subscribed
-- Date: 2026-07-14 | STAGED FOR REVIEW — DO NOT APPLY without explicit
-- sign-off. This project has NO Supabase branching; apply manually via the
-- SQL editor/psql after review.
--
-- Verified evidence (2026-07-14):
--   * Realtime WAL-decode statements = 23,297 s of 29,356 s total DB time
--     (79.4%) over the 113-day pg_stat_statements window — the single
--     largest DB-time consumer in the project.
--   * Publication currently contains 6 public tables:
--       design_snapshots, board_relation_links, comments, notifications,
--       chat_conversations, chat_messages
--   * Subscriber inventory across ALL local repos (print-room-portal,
--     print-room-staff-portal, print-room-studio, print-room-no-design-tool,
--     tech-pack-builder, print-room-chatbot-api, uniforms-store-nextjs,
--     print-room-ui), grepping for postgres_changes/.channel(:
--       - chat_conversations  → staff portal (useChatInbox, useConversation) KEEP
--       - chat_messages       → staff portal (useChatInbox, useConversation) KEEP
--       - design_snapshots, board_relation_links, comments, notifications
--                             → ZERO subscribers anywhere                    DROP
--
-- Related bugs found during the inventory (NOT fixed here — the fix is a
-- product decision because adding tables adds WAL-decode cost):
--   * staff portal ArtworkLibrary.tsx subscribes to
--     organization_artwork_variants — not in the publication → dead listener.
--   * print-room-studio design tool subscribes to products/product_images —
--     not in the publication → dead listeners.
--
-- PRE-APPLY VERIFICATION:
--   1. Re-confirm the publication contents:
--        select tablename from pg_publication_tables
--        where pubname = 'supabase_realtime' and schemaname = 'public';
--   2. Re-run the subscriber grep in any repo deployed since 2026-07-14:
--        grep -rn "postgres_changes" --include='*.ts*' <repo>/src <repo>/app
--      and confirm none of the four dropped tables appears.
--
-- Effect: WAL for the dropped tables is no longer decoded/filtered by the
-- realtime worker. Chat realtime is untouched.
-- ============================================================================

alter publication supabase_realtime drop table
  public.design_snapshots,
  public.board_relation_links,
  public.comments,
  public.notifications;

-- ============================= ROLLBACK =====================================
-- alter publication supabase_realtime add table
--   public.design_snapshots,
--   public.board_relation_links,
--   public.comments,
--   public.notifications;
