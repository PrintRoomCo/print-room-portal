-- =====================================================================
-- B6: Covering indexes for unindexed foreign keys
-- =====================================================================
-- Purpose:
--   Add a btree index on each foreign-key column that currently has no
--   covering index, per the `unindexed_foreign_keys` performance
--   advisor lint. Missing FK indexes force sequential scans on the
--   child table for every parent-row UPDATE/DELETE (to check for
--   dependent rows) and for any application query that joins/filters
--   on the FK column.
--
-- Date: 2026-07-14
--
-- STAGED FOR REVIEW — DO NOT APPLY without explicit sign-off.
-- This project has NO Supabase branching; apply manually via the
-- SQL editor/psql after review. Project ref: bthsxgmcnbvwwgvdveek.
--
-- *** CREATE INDEX CONCURRENTLY cannot run inside a transaction block. ***
-- Apply the statements below ONE BY ONE (each is its own implicit
-- transaction), not as a single pasted batch inside BEGIN/COMMIT and
-- not via a migration runner that wraps DDL in a transaction. If a
-- CONCURRENTLY build fails partway through, it can leave an INVALID
-- index behind — check `pg_index.indisvalid` afterwards and
-- `DROP INDEX CONCURRENTLY` + retry any invalid ones before moving on.
--
-- Evidence (verified 2026-07-14 against project bthsxgmcnbvwwgvdveek):
--   Advisor `unindexed_foreign_keys` lint: 79 findings.
--   Catalog cross-check: queried pg_constraint (contype = 'f') joined to
--     pg_attribute for public schema, independently of the advisor JSON,
--     found 246 total FK constraints in public schema. Intersecting the
--     advisor's 79 (table, fkey_name) pairs against that catalog result
--     by fkey_name matched all 79 with zero misses and zero duplicate
--     names — i.e. the FK columns below are read from pg_constraint /
--     pg_attribute directly (authoritative), not inferred from the
--     advisor's free-text `detail` strings or guessed from naming
--     convention. All 79 are single-column foreign keys (no composite
--     FKs in this set), so each gets one single-column index.
--   Row counts are from pg_stat_user_tables.n_live_tup, captured
--     2026-07-14, and are estimates (not exact live counts) — see
--     pre-apply verification query below to refresh them before
--     applying, since this list is ordered by row count descending and
--     stale counts could reorder priority.
--
-- Pre-apply verification query (run before applying, to confirm the FK
-- still exists, is still missing a covering index, and to refresh row
-- counts / reorder priority if this file is applied much later than
-- 2026-07-14):
--
--   SELECT
--     cls.relname AS table_name,
--     con.conname AS fkey_name,
--     array_agg(att.attname ORDER BY k.ord) AS fk_columns,
--     (SELECT n_live_tup FROM pg_stat_user_tables
--       WHERE schemaname = 'public' AND relname = cls.relname) AS live_rows,
--     EXISTS (
--       SELECT 1 FROM pg_index ix
--       WHERE ix.indrelid = con.conrelid
--         AND (ix.indkey::int2[])[0:array_length(con.conkey,1)-1] = con.conkey
--     ) AS still_missing_check_is_approximate
--   FROM pg_constraint con
--   JOIN pg_class cls ON cls.oid = con.conrelid
--   JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
--   JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
--   JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
--   WHERE con.contype = 'f' AND nsp.nspname = 'public'
--     AND con.conname IN (/* paste the 79 fkey_name values from the
--                            comments below, or just re-run get_advisors
--                            and diff the unindexed_foreign_keys list */)
--   GROUP BY cls.relname, con.conname, con.conrelid
--   ORDER BY live_rows DESC NULLS LAST;
--
--   Simpler alternative: just re-run `get_advisors` (performance) and
--   diff the `unindexed_foreign_keys` finding list against the 79 below
--   — if a finding disappeared, someone already indexed that FK; skip
--   its line. If new findings appeared, they are out of scope for this
--   file (draft a follow-up).
-- =====================================================================


-- ===== FORWARD =====
-- Ordered by public.<table>'s live row count DESC (pg_stat_user_tables.n_live_tup,
-- captured 2026-07-14). Row count is in the trailing comment on each line.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_variants_color_swatch_id ON public.product_variants (color_swatch_id);  -- fk product_variants_color_swatch_id_fkey, 35409 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_variants_size_id ON public.product_variants (size_id);  -- fk product_variants_size_id_fkey, 35409 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_id ON public.products (category_id);  -- fk products_category_id_fkey, 3827 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_import_jobs_created_by ON public.supplier_import_jobs (created_by);  -- fk supplier_import_jobs_created_by_fkey, 945 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staging_shopify_products_catalogue_item_id ON public.staging_shopify_products (catalogue_item_id);  -- fk staging_shopify_products_catalogue_item_id_fkey, 195 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staging_shopify_products_matched_product_id ON public.staging_shopify_products (matched_product_id);  -- fk staging_shopify_products_matched_product_id_fkey, 195 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variant_inventory_size_id ON public.variant_inventory (size_id);  -- fk variant_inventory_size_id_fkey, 95 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staging_shopify_company_locations_store_id ON public.staging_shopify_company_locations (store_id);  -- fk staging_shopify_company_locations_store_id_fkey, 55 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_catalogue_items_card_image_id ON public.b2b_catalogue_items (card_image_id);  -- fk b2b_catalogue_items_card_image_id_fkey, 43 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_catalogue_item_decorations_published_by_user_id ON public.b2b_catalogue_item_decorations (published_by_user_id);  -- fk b2b_catalogue_item_decorations_published_by_user_id_fkey, 34 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_catalogue_item_decorations_snapshot_color_swatch_id ON public.b2b_catalogue_item_decorations (snapshot_color_swatch_id);  -- fk b2b_catalogue_item_decorations_snapshot_color_swatch_id_fkey, 34 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staging_shopify_companies_b2b_account_id ON public.staging_shopify_companies (b2b_account_id);  -- fk staging_shopify_companies_b2b_account_id_fkey, 18 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staging_shopify_companies_organization_id ON public.staging_shopify_companies (organization_id);  -- fk staging_shopify_companies_organization_id_fkey, 18 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_sync_runs_supplier_id ON public.supplier_sync_runs (supplier_id);  -- fk supplier_sync_runs_supplier_id_fkey, 12 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_approved_by ON public.orders (approved_by);  -- fk orders_approved_by_fkey, 10 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_assigned_to ON public.orders (assigned_to);  -- fk orders_assigned_to_fkey, 10 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_order_proof_approved_by ON public.orders (order_proof_approved_by);  -- fk orders_order_proof_approved_by_fkey, 10 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_payment_id ON public.orders (payment_id);  -- fk orders_payment_id_fkey, 10 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_decorations_decoration_location_id ON public.org_decorations (decoration_location_id);  -- fk org_decorations_decoration_location_id_fkey, 10 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_conversations_assigned_staff_id ON public.chat_conversations (assigned_staff_id);  -- fk chat_conversations_assigned_staff_id_fkey, 5 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_accounts_customer_tier_id ON public.b2b_accounts (customer_tier_id);  -- fk b2b_accounts_customer_tier_id_fkey, 4 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_catalogues_created_by_user_id ON public.b2b_catalogues (created_by_user_id);  -- fk b2b_catalogues_created_by_user_id_fkey, 4 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_print_areas_decoration_location_id ON public.product_print_areas (decoration_location_id);  -- fk product_print_areas_decoration_location_id_fkey, 4 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_member_catalogue_grants_granted_by ON public.b2b_member_catalogue_grants (granted_by);  -- fk b2b_member_catalogue_grants_granted_by_fkey, 2 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_briefs_organization_id ON public.briefs (organization_id);  -- fk briefs_organization_id_fkey, 1 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_tag_catalog_created_by ON public.product_tag_catalog (created_by);  -- fk product_tag_catalog_created_by_fkey, 1 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proof_editable_field_paths_updated_by ON public.proof_editable_field_paths (updated_by);  -- fk proof_editable_field_paths_updated_by_fkey, 1 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_requests_processed_by ON public.account_requests (processed_by);  -- fk account_requests_processed_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_user_id ON public.activities (user_id);  -- fk activities_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_generation_history_organization_id ON public.ai_generation_history (organization_id);  -- fk ai_generation_history_organization_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_member_catalogue_item_grants_granted_by ON public.b2b_member_catalogue_item_grants (granted_by);  -- fk b2b_member_catalogue_item_grants_granted_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_ordering_period_item_pricing_catalogue_item_id ON public.b2b_ordering_period_item_pricing (catalogue_item_id);  -- fk b2b_ordering_period_item_pricing_catalogue_item_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_relations_mirror_column_id ON public.board_relations (mirror_column_id);  -- fk board_relations_mirror_column_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_templates_created_by ON public.board_templates (created_by);  -- fk board_templates_created_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_views_created_by ON public.board_views (created_by);  -- fk board_views_created_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boards_created_by ON public.boards (created_by);  -- fk boards_created_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bom_items_manufacturer_id ON public.bom_items (manufacturer_id);  -- fk bom_items_manufacturer_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bom_items_selected_color_id ON public.bom_items (selected_color_id);  -- fk bom_items_selected_color_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brief_items_product_id ON public.brief_items (product_id);  -- fk brief_items_product_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cart_items_cart_id ON public.cart_items (cart_id);  -- fk cart_items_cart_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_user_id ON public.comments (user_id);  -- fk comments_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_artwork_user_id ON public.design_artwork (user_id);  -- fk design_artwork_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_proof_versions_created_by_user_id ON public.design_proof_versions (created_by_user_id);  -- fk design_proof_versions_created_by_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_proofs_created_by_user_id ON public.design_proofs (created_by_user_id);  -- fk design_proofs_created_by_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_proofs_current_version_id ON public.design_proofs (current_version_id);  -- fk design_proofs_current_version_fk, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_designs_user_id ON public.designs (user_id);  -- fk designs_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_attachments_column_id ON public.file_attachments (column_id);  -- fk file_attachments_column_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_attachments_item_id ON public.file_attachments (item_id);  -- fk file_attachments_item_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_attachments_uploaded_by ON public.file_attachments (uploaded_by);  -- fk file_attachments_uploaded_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folders_created_by ON public.folders (created_by);  -- fk folders_created_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generated_image_assets_job_id ON public.generated_image_assets (job_id);  -- fk generated_image_assets_job_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_created_by ON public.items (created_by);  -- fk items_created_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_item_colors_library_color_id ON public.library_item_colors (library_color_id);  -- fk library_item_colors_library_color_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_board_id ON public.notifications (board_id);  -- fk notifications_board_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_item_id ON public.notifications (item_id);  -- fk notifications_item_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_users_user_id ON public.org_users (user_id);  -- fk org_users_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_artwork_variants_created_by ON public.organization_artwork_variants (created_by);  -- fk organization_artwork_variants_created_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_catalogs_product_id ON public.product_catalogs (product_id);  -- fk product_catalogs_product_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_catalogs_supplier_id ON public.product_catalogs (supplier_id);  -- fk product_catalogs_supplier_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_colors_color_id ON public.product_colors (color_id);  -- fk fk_pc_color, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_sizes_link_size_id ON public.product_sizes_link (size_id);  -- fk product_sizes_link_size_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proof_amendment_requests_proof_version_id ON public.proof_amendment_requests (proof_version_id);  -- fk proof_amendment_requests_proof_version_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proof_amendment_requests_requested_by_user_id ON public.proof_amendment_requests (requested_by_user_id);  -- fk proof_amendment_requests_requested_by_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proof_amendment_requests_resolved_by_user_id ON public.proof_amendment_requests (resolved_by_user_id);  -- fk proof_amendment_requests_resolved_by_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proof_catalogue_links_proof_id ON public.proof_catalogue_links (proof_id);  -- fk proof_catalogue_links_proof_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenprint_size_limits_v1_surcharge_key ON public.screenprint_size_limits_v1 (surcharge_key);  -- fk screenprint_size_limits_v1_surcharge_key_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_notifications_share_id ON public.share_notifications (share_id);  -- fk share_notifications_share_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_quotes_approved_by ON public.staff_quotes (approved_by);  -- fk staff_quotes_approved_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_packs_parent_version_id ON public.tech_packs (parent_version_id);  -- fk tech_packs_parent_version_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variant_inventory_events_reference_quote_item_id ON public.variant_inventory_events (reference_quote_item_id);  -- fk variant_inventory_events_reference_quote_item_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variant_inventory_events_size_id ON public.variant_inventory_events (size_id);  -- fk variant_inventory_events_size_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variant_inventory_events_staff_user_id ON public.variant_inventory_events (staff_user_id);  -- fk variant_inventory_events_staff_user_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variant_inventory_events_variant_id ON public.variant_inventory_events (variant_id);  -- fk variant_inventory_events_variant_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variant_reorder_requests_requested_by ON public.variant_reorder_requests (requested_by);  -- fk variant_reorder_requests_requested_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variant_reorder_requests_size_id ON public.variant_reorder_requests (size_id);  -- fk variant_reorder_requests_size_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variant_reorder_requests_variant_id ON public.variant_reorder_requests (variant_id);  -- fk variant_reorder_requests_variant_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_invitations_invited_by ON public.workspace_invitations (invited_by);  -- fk workspace_invitations_invited_by_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_invitations_workspace_id ON public.workspace_invitations (workspace_id);  -- fk workspace_invitations_workspace_id_fkey, 0 live rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspaces_created_by ON public.workspaces (created_by);  -- fk workspaces_created_by_fkey, 0 live rows


-- ===== ROLLBACK =====
-- Also cannot run inside a transaction — apply one statement at a time.
-- Same ordering as FORWARD, for easy line-by-line pairing.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_variants_color_swatch_id;  -- was covering fk product_variants_color_swatch_id_fkey on product_variants (35409 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_variants_size_id;  -- was covering fk product_variants_size_id_fkey on product_variants (35409 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_products_category_id;  -- was covering fk products_category_id_fkey on products (3827 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_supplier_import_jobs_created_by;  -- was covering fk supplier_import_jobs_created_by_fkey on supplier_import_jobs (945 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staging_shopify_products_catalogue_item_id;  -- was covering fk staging_shopify_products_catalogue_item_id_fkey on staging_shopify_products (195 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staging_shopify_products_matched_product_id;  -- was covering fk staging_shopify_products_matched_product_id_fkey on staging_shopify_products (195 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_variant_inventory_size_id;  -- was covering fk variant_inventory_size_id_fkey on variant_inventory (95 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staging_shopify_company_locations_store_id;  -- was covering fk staging_shopify_company_locations_store_id_fkey on staging_shopify_company_locations (55 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_catalogue_items_card_image_id;  -- was covering fk b2b_catalogue_items_card_image_id_fkey on b2b_catalogue_items (43 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_catalogue_item_decorations_published_by_user_id;  -- was covering fk b2b_catalogue_item_decorations_published_by_user_id_fkey on b2b_catalogue_item_decorations (34 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_catalogue_item_decorations_snapshot_color_swatch_id;  -- was covering fk b2b_catalogue_item_decorations_snapshot_color_swatch_id_fkey on b2b_catalogue_item_decorations (34 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staging_shopify_companies_b2b_account_id;  -- was covering fk staging_shopify_companies_b2b_account_id_fkey on staging_shopify_companies (18 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staging_shopify_companies_organization_id;  -- was covering fk staging_shopify_companies_organization_id_fkey on staging_shopify_companies (18 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_supplier_sync_runs_supplier_id;  -- was covering fk supplier_sync_runs_supplier_id_fkey on supplier_sync_runs (12 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_approved_by;  -- was covering fk orders_approved_by_fkey on orders (10 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_assigned_to;  -- was covering fk orders_assigned_to_fkey on orders (10 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_order_proof_approved_by;  -- was covering fk orders_order_proof_approved_by_fkey on orders (10 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_payment_id;  -- was covering fk orders_payment_id_fkey on orders (10 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_org_decorations_decoration_location_id;  -- was covering fk org_decorations_decoration_location_id_fkey on org_decorations (10 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_chat_conversations_assigned_staff_id;  -- was covering fk chat_conversations_assigned_staff_id_fkey on chat_conversations (5 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_accounts_customer_tier_id;  -- was covering fk b2b_accounts_customer_tier_id_fkey on b2b_accounts (4 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_catalogues_created_by_user_id;  -- was covering fk b2b_catalogues_created_by_user_id_fkey on b2b_catalogues (4 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_print_areas_decoration_location_id;  -- was covering fk product_print_areas_decoration_location_id_fkey on product_print_areas (4 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_member_catalogue_grants_granted_by;  -- was covering fk b2b_member_catalogue_grants_granted_by_fkey on b2b_member_catalogue_grants (2 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_briefs_organization_id;  -- was covering fk briefs_organization_id_fkey on briefs (1 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_tag_catalog_created_by;  -- was covering fk product_tag_catalog_created_by_fkey on product_tag_catalog (1 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_proof_editable_field_paths_updated_by;  -- was covering fk proof_editable_field_paths_updated_by_fkey on proof_editable_field_paths (1 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_account_requests_processed_by;  -- was covering fk account_requests_processed_by_fkey on account_requests (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_user_id;  -- was covering fk activities_user_id_fkey on activities (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ai_generation_history_organization_id;  -- was covering fk ai_generation_history_organization_id_fkey on ai_generation_history (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_member_catalogue_item_grants_granted_by;  -- was covering fk b2b_member_catalogue_item_grants_granted_by_fkey on b2b_member_catalogue_item_grants (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_ordering_period_item_pricing_catalogue_item_id;  -- was covering fk b2b_ordering_period_item_pricing_catalogue_item_id_fkey on b2b_ordering_period_item_pricing (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_relations_mirror_column_id;  -- was covering fk board_relations_mirror_column_id_fkey on board_relations (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_templates_created_by;  -- was covering fk board_templates_created_by_fkey on board_templates (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_views_created_by;  -- was covering fk board_views_created_by_fkey on board_views (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_boards_created_by;  -- was covering fk boards_created_by_fkey on boards (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bom_items_manufacturer_id;  -- was covering fk bom_items_manufacturer_id_fkey on bom_items (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bom_items_selected_color_id;  -- was covering fk bom_items_selected_color_id_fkey on bom_items (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_brief_items_product_id;  -- was covering fk brief_items_product_id_fkey on brief_items (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cart_items_cart_id;  -- was covering fk cart_items_cart_id_fkey on cart_items (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comments_user_id;  -- was covering fk comments_user_id_fkey on comments (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_artwork_user_id;  -- was covering fk design_artwork_user_id_fkey on design_artwork (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_proof_versions_created_by_user_id;  -- was covering fk design_proof_versions_created_by_user_id_fkey on design_proof_versions (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_proofs_created_by_user_id;  -- was covering fk design_proofs_created_by_user_id_fkey on design_proofs (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_proofs_current_version_id;  -- was covering fk design_proofs_current_version_fk on design_proofs (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_designs_user_id;  -- was covering fk designs_user_id_fkey on designs (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_file_attachments_column_id;  -- was covering fk file_attachments_column_id_fkey on file_attachments (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_file_attachments_item_id;  -- was covering fk file_attachments_item_id_fkey on file_attachments (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_file_attachments_uploaded_by;  -- was covering fk file_attachments_uploaded_by_fkey on file_attachments (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_folders_created_by;  -- was covering fk folders_created_by_fkey on folders (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_generated_image_assets_job_id;  -- was covering fk generated_image_assets_job_id_fkey on generated_image_assets (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_items_created_by;  -- was covering fk items_created_by_fkey on items (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_library_item_colors_library_color_id;  -- was covering fk library_item_colors_library_color_id_fkey on library_item_colors (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_board_id;  -- was covering fk notifications_board_id_fkey on notifications (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_item_id;  -- was covering fk notifications_item_id_fkey on notifications (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_org_users_user_id;  -- was covering fk org_users_user_id_fkey on org_users (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_organization_artwork_variants_created_by;  -- was covering fk organization_artwork_variants_created_by_fkey on organization_artwork_variants (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_catalogs_product_id;  -- was covering fk product_catalogs_product_id_fkey on product_catalogs (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_catalogs_supplier_id;  -- was covering fk product_catalogs_supplier_id_fkey on product_catalogs (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_colors_color_id;  -- was covering fk fk_pc_color on product_colors (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_sizes_link_size_id;  -- was covering fk product_sizes_link_size_id_fkey on product_sizes_link (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_proof_amendment_requests_proof_version_id;  -- was covering fk proof_amendment_requests_proof_version_id_fkey on proof_amendment_requests (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_proof_amendment_requests_requested_by_user_id;  -- was covering fk proof_amendment_requests_requested_by_user_id_fkey on proof_amendment_requests (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_proof_amendment_requests_resolved_by_user_id;  -- was covering fk proof_amendment_requests_resolved_by_user_id_fkey on proof_amendment_requests (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_proof_catalogue_links_proof_id;  -- was covering fk proof_catalogue_links_proof_id_fkey on proof_catalogue_links (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_screenprint_size_limits_v1_surcharge_key;  -- was covering fk screenprint_size_limits_v1_surcharge_key_fkey on screenprint_size_limits_v1 (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_share_notifications_share_id;  -- was covering fk share_notifications_share_id_fkey on share_notifications (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staff_quotes_approved_by;  -- was covering fk staff_quotes_approved_by_fkey on staff_quotes (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_packs_parent_version_id;  -- was covering fk tech_packs_parent_version_id_fkey on tech_packs (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_variant_inventory_events_reference_quote_item_id;  -- was covering fk variant_inventory_events_reference_quote_item_id_fkey on variant_inventory_events (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_variant_inventory_events_size_id;  -- was covering fk variant_inventory_events_size_id_fkey on variant_inventory_events (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_variant_inventory_events_staff_user_id;  -- was covering fk variant_inventory_events_staff_user_id_fkey on variant_inventory_events (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_variant_inventory_events_variant_id;  -- was covering fk variant_inventory_events_variant_id_fkey on variant_inventory_events (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_variant_reorder_requests_requested_by;  -- was covering fk variant_reorder_requests_requested_by_fkey on variant_reorder_requests (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_variant_reorder_requests_size_id;  -- was covering fk variant_reorder_requests_size_id_fkey on variant_reorder_requests (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_variant_reorder_requests_variant_id;  -- was covering fk variant_reorder_requests_variant_id_fkey on variant_reorder_requests (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_workspace_invitations_invited_by;  -- was covering fk workspace_invitations_invited_by_fkey on workspace_invitations (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_workspace_invitations_workspace_id;  -- was covering fk workspace_invitations_workspace_id_fkey on workspace_invitations (0 live rows at draft time)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_workspaces_created_by;  -- was covering fk workspaces_created_by_fkey on workspaces (0 live rows at draft time)
