-- =====================================================================
-- B7: Drop unused and duplicate indexes
-- =====================================================================
-- Purpose:
--   Remove indexes that are pure carrying cost with no read benefit:
--     (a) duplicate_index — two or more indexes with byte-identical
--         definitions on the same table; keep one, drop the rest.
--     (b) unused_index — indexes that Postgres has never used to
--         satisfy a scan since stats were last reset.
--   Every index write (INSERT/UPDATE/DELETE on the table) pays the
--   cost of maintaining these indexes for zero query-planning benefit.
--
-- Date: 2026-07-14
--
-- STAGED FOR REVIEW — DO NOT APPLY without explicit sign-off.
-- This project has NO Supabase branching; apply manually via the
-- SQL editor/psql after review. Project ref: bthsxgmcnbvwwgvdveek.
--
-- *** DROP INDEX CONCURRENTLY cannot run inside a transaction block. ***
-- Apply the statements below ONE BY ONE, not as a pasted batch inside
-- BEGIN/COMMIT and not via a migration runner that wraps DDL in a
-- transaction.
--
-- Evidence (verified 2026-07-14 against project bthsxgmcnbvwwgvdveek):
--   Advisor `unused_index` lint: 201 findings. Advisor `duplicate_index`
--   lint: 15 findings (15 groups of exactly 2 indexes each = 30 index
--   names total).
--   Of the 201 `unused_index` findings, 192 are in the `public` schema
--   and 9 are in the `preorder` schema (CollectionGoal, ProgressCache,
--   TrackedOrder tables). This file's DROP statements are written as
--   `public.<index>` per spec, so the 9 `preorder`-schema findings are
--   OUT OF SCOPE here — flagged for a separate follow-up file if
--   `preorder.*` cleanup is wanted, not silently dropped or renamed.
--   All 192 public-schema `unused_index` names were re-verified live
--   against pg_stat_user_indexes/pg_index/pg_constraint on 2026-07-14:
--     - All 192 currently have idx_scan = 0.
--     - None of the 192 back a table constraint (checked via
--       pg_constraint.conindid — see pre-apply query below, same
--       check, for the applier to re-run before applying).
--   All 15 `duplicate_index` groups were re-verified live the same way:
--     - 13 of the 15 groups resolve cleanly: the non-canonical index in
--       each pair does NOT back a constraint, so a plain
--       `DROP INDEX CONCURRENTLY` is safe. These are in the DUPLICATES
--       section below.
--     - 2 of the 15 groups are FLAGGED, NOT DROPPED, because BOTH
--       indexes in the pair back a real UNIQUE constraint each (two
--       separate, redundant UNIQUE constraints on the same column(s),
--       not just two redundant indexes) — see "FLAGGED — DO NOT DROP"
--       below. Postgres refuses `DROP INDEX` on a constraint's backing
--       index; resolving these requires `ALTER TABLE ... DROP
--       CONSTRAINT ...`, which is a different, riskier kind of change
--       (must confirm which constraint name any FKs/app code reference)
--       and is out of scope for this index-cleanup file.
--   7 index names appear in BOTH the duplicate-group drop list and the
--     unused-index drop list (a duplicate index is often also unused).
--     Each such index is dropped exactly ONCE, in the DUPLICATES
--     section, and is excluded from the UNUSED section to avoid a
--     redundant statement. They are: idx_design_snapshots_instance_id,
--     idx_payments_quote_id, idx_share_access_logs_share_id,
--     idx_share_comments_share_id, idx_tech_pack_shares_tech_pack,
--     idx_tech_pack_shares_vendor_id, ix_product_sizes_link_product.
--   Forward statement count: 13 (duplicates) + 185 (unused-only) = 198.
--   Rollback statement count: 13 (duplicates) + 185 (unused-only) = 198.
--
-- Pre-apply verification query — run this IMMEDIATELY before applying
-- any DROP below. It re-checks idx_scan = 0 for every index this file
-- intends to drop, and re-checks that none of them back a constraint.
-- The advisor's stats window began 2026-03-23 (last stats reset on this
-- project) — if this file is applied much later, a nonzero idx_scan may
-- simply mean the index was hit once by a month-end/seasonal report or
-- an ad-hoc query that doesn't run day-to-day. DO NOT blindly trust a
-- zero from months ago: re-run this query fresh, and remove any index
-- from the drop list whose idx_scan is no longer 0, or whose
-- backs_constraint flipped to true:
--
--   SELECT
--     n.nspname AS schema_name,
--     i.relname AS index_name,
--     t.relname AS table_name,
--     COALESCE(s.idx_scan, 0) AS idx_scan,
--     s.last_idx_scan,
--     EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid) AS backs_constraint
--   FROM pg_class i
--   JOIN pg_namespace n ON n.oid = i.relnamespace AND n.nspname = 'public'
--   JOIN pg_index ix ON ix.indexrelid = i.oid
--   JOIN pg_class t ON t.oid = ix.indrelid
--   LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
--   WHERE i.relname IN (
--     -- paste every index name from the DUPLICATES + UNUSED sections
--     -- below, or just re-run get_advisors (performance) and diff the
--     -- unused_index / duplicate_index finding lists against this file
--   )
--   ORDER BY idx_scan DESC, index_name;
--
--   If ANY row comes back with idx_scan > 0 or backs_constraint = true,
--   remove that index's DROP (and matching rollback CREATE) line before
--   applying the rest.
-- =====================================================================


-- ===== FORWARD: DUPLICATES (13 safe drops) =====
-- Each pair was confirmed byte-identical in definition via
-- pg_get_indexdef(). The KEPT index is named in the comment; the
-- DROPPED index is the one being removed here.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_bom_items_tech_pack_id;  -- duplicate of idx_bom_items_tech_pack (kept) on bom_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_snapshots_instance_id;  -- duplicate of design_snapshots_instance_idx (kept) on design_snapshots
DROP INDEX CONCURRENTLY IF EXISTS public.ux_snapshots_instance_view;  -- duplicate of design_snapshots_pkey (kept, PRIMARY KEY — cannot be dropped) on design_snapshots
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payments_quote_id;  -- duplicate of idx_payments_quote (kept) on payments
DROP INDEX CONCURRENTLY IF EXISTS public.uq_ppt_by_product_option;  -- duplicate of uq_ppt_by_product_no_sku_with_cvid (kept) on product_pricing_tiers
DROP INDEX CONCURRENTLY IF EXISTS public.uq_ppt_by_product_no_sku_no_cvid;  -- duplicate of uq_ppt_by_product_base (kept) on product_pricing_tiers
DROP INDEX CONCURRENTLY IF EXISTS public.uq_ppt_by_sku_with_cvid;  -- duplicate of uq_ppt_by_sku_option (kept) on product_pricing_tiers
DROP INDEX CONCURRENTLY IF EXISTS public.uq_ppt_by_sku_no_cvid;  -- duplicate of uq_ppt_by_sku_base (kept) on product_pricing_tiers
DROP INDEX CONCURRENTLY IF EXISTS public.ix_product_sizes_link_product;  -- duplicate of idx_product_sizes_link_product (kept) on product_sizes_link
DROP INDEX CONCURRENTLY IF EXISTS public.idx_share_access_logs_share_id;  -- duplicate of idx_share_access_logs_share (kept) on share_access_logs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_share_comments_share_id;  -- duplicate of idx_share_comments_share (kept) on share_comments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_shares_tech_pack;  -- duplicate of idx_tech_pack_shares_pack_id (kept) on tech_pack_shares
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_shares_vendor_id;  -- duplicate of idx_tech_pack_shares_vendor (kept) on tech_pack_shares

-- ===== FLAGGED — DO NOT DROP (2 of the 15 duplicate_index groups) =====
-- Both indexes in each of these two pairs independently back a real
-- UNIQUE constraint (verified via pg_constraint.conindid, contype='u').
-- Postgres will refuse a plain DROP INDEX on either one
-- ("cannot drop index ... because constraint ... requires it"). No DDL
-- is emitted for these — resolving the redundant *constraint* (not just
-- the index) needs its own reviewed change:
--
--   Table `categories`: indexes {categories_name_key, categories_name_unique}
--     are each backing their OWN separate UNIQUE constraint of the same
--     name, both on (name). idx_scan at draft time: categories_name_key=38,
--     categories_name_unique=61 — both are in active use, not "unused".
--     Follow-up: pick one constraint to keep, `ALTER TABLE public.categories
--     DROP CONSTRAINT <loser>`, confirm no FK or app code references the
--     dropped constraint's name specifically.
--
--   Table `exchange_rates`: indexes {exchange_rates_pair_unique, uq_exchange_rate}
--     are each backing their OWN separate UNIQUE constraint of the same
--     name, both on (base_currency, target_currency). idx_scan at draft
--     time: exchange_rates_pair_unique=0, uq_exchange_rate=2296 (heavily
--     used — do NOT drop this one). Follow-up: drop the
--     `exchange_rates_pair_unique` constraint (0 scans, redundant),
--     keep `uq_exchange_rate`, same caveats as above re: FK/app-code
--     references.


-- ===== FORWARD: UNUSED (185 drops; excludes the 7 already covered above) =====
-- idx_scan = 0 for all of these as of 2026-07-14. None back a
-- constraint. Re-verify both facts with the pre-apply query above
-- before running.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_account_requests_created_at;  -- unused_index, idx_scan=0 at draft time, table account_requests
DROP INDEX CONCURRENTLY IF EXISTS public.idx_account_requests_email;  -- unused_index, idx_scan=0 at draft time, table account_requests
DROP INDEX CONCURRENTLY IF EXISTS public.idx_account_requests_platform;  -- unused_index, idx_scan=0 at draft time, table account_requests
DROP INDEX CONCURRENTLY IF EXISTS public.idx_account_requests_status;  -- unused_index, idx_scan=0 at draft time, table account_requests
DROP INDEX CONCURRENTLY IF EXISTS public.idx_account_requests_supabase_user_id;  -- unused_index, idx_scan=0 at draft time, table account_requests
DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_board;  -- unused_index, idx_scan=0 at draft time, table activities
DROP INDEX CONCURRENTLY IF EXISTS public.idx_activities_item;  -- unused_index, idx_scan=0 at draft time, table activities
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ai_generation_history_type;  -- unused_index, idx_scan=0 at draft time, table ai_generation_history
DROP INDEX CONCURRENTLY IF EXISTS public.b2b_accounts_account_manager_id_idx;  -- unused_index, idx_scan=0 at draft time, table b2b_accounts
DROP INDEX CONCURRENTLY IF EXISTS public.idx_b2b_accounts_platform;  -- unused_index, idx_scan=0 at draft time, table b2b_accounts
DROP INDEX CONCURRENTLY IF EXISTS public.b2b_catalogue_item_decorations_decoration_idx;  -- unused_index, idx_scan=0 at draft time, table b2b_catalogue_item_decorations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_relation_links_relation;  -- unused_index, idx_scan=0 at draft time, table board_relation_links
DROP INDEX CONCURRENTLY IF EXISTS public.idx_relation_links_source;  -- unused_index, idx_scan=0 at draft time, table board_relation_links
DROP INDEX CONCURRENTLY IF EXISTS public.idx_relation_links_target;  -- unused_index, idx_scan=0 at draft time, table board_relation_links
DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_relations_column;  -- unused_index, idx_scan=0 at draft time, table board_relations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_relations_source;  -- unused_index, idx_scan=0 at draft time, table board_relations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_relations_target;  -- unused_index, idx_scan=0 at draft time, table board_relations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_templates_category;  -- unused_index, idx_scan=0 at draft time, table board_templates
DROP INDEX CONCURRENTLY IF EXISTS public.idx_board_views_board;  -- unused_index, idx_scan=0 at draft time, table board_views
DROP INDEX CONCURRENTLY IF EXISTS public.idx_boards_folder;  -- unused_index, idx_scan=0 at draft time, table boards
DROP INDEX CONCURRENTLY IF EXISTS public.idx_boards_workspace;  -- unused_index, idx_scan=0 at draft time, table boards
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bom_items_category;  -- unused_index, idx_scan=0 at draft time, table bom_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bom_items_library_item;  -- unused_index, idx_scan=0 at draft time, table bom_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bom_items_tech_pack;  -- unused_index, idx_scan=0 at draft time, table bom_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_brands_hero_product;  -- unused_index, idx_scan=0 at draft time, table brands
DROP INDEX CONCURRENTLY IF EXISTS public.idx_brands_platform;  -- unused_index, idx_scan=0 at draft time, table brands
DROP INDEX CONCURRENTLY IF EXISTS public.brief_items_brief_idx;  -- unused_index, idx_scan=0 at draft time, table brief_items
DROP INDEX CONCURRENTLY IF EXISTS public.briefs_anon_token_idx;  -- unused_index, idx_scan=0 at draft time, table briefs
DROP INDEX CONCURRENTLY IF EXISTS public.briefs_share_token_idx;  -- unused_index, idx_scan=0 at draft time, table briefs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_business_rules_active;  -- unused_index, idx_scan=0 at draft time, table business_rules
DROP INDEX CONCURRENTLY IF EXISTS public.idx_categories_hero_product;  -- unused_index, idx_scan=0 at draft time, table categories
DROP INDEX CONCURRENTLY IF EXISTS public.idx_categories_platform;  -- unused_index, idx_scan=0 at draft time, table categories
DROP INDEX CONCURRENTLY IF EXISTS public.idx_categories_type;  -- unused_index, idx_scan=0 at draft time, table categories
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cell_values_column;  -- unused_index, idx_scan=0 at draft time, table cell_values
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cell_values_item;  -- unused_index, idx_scan=0 at draft time, table cell_values
DROP INDEX CONCURRENTLY IF EXISTS public.chat_conversations_open_idx;  -- unused_index, idx_scan=0 at draft time, table chat_conversations
DROP INDEX CONCURRENTLY IF EXISTS public.chat_conversations_owner_idx;  -- unused_index, idx_scan=0 at draft time, table chat_conversations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_columns_board;  -- unused_index, idx_scan=0 at draft time, table columns
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comments_board;  -- unused_index, idx_scan=0 at draft time, table comments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comments_item;  -- unused_index, idx_scan=0 at draft time, table comments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comments_parent;  -- unused_index, idx_scan=0 at draft time, table comments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_decoration_locations_active;  -- unused_index, idx_scan=0 at draft time, table decoration_locations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_collections_company_id;  -- unused_index, idx_scan=0 at draft time, table design_collections
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_collections_created_at;  -- unused_index, idx_scan=0 at draft time, table design_collections
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_collections_customer_email;  -- unused_index, idx_scan=0 at draft time, table design_collections
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_collections_monday_item_id;  -- unused_index, idx_scan=0 at draft time, table design_collections
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_collections_quote_id;  -- unused_index, idx_scan=0 at draft time, table design_collections
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_collections_status;  -- unused_index, idx_scan=0 at draft time, table design_collections
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_drafts_product;  -- unused_index, idx_scan=0 at draft time, table design_drafts
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_orders_email;  -- unused_index, idx_scan=0 at draft time, table design_orders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_orders_platform;  -- unused_index, idx_scan=0 at draft time, table design_orders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_orders_shopify;  -- unused_index, idx_scan=0 at draft time, table design_orders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_orders_shopify_order_id;  -- unused_index, idx_scan=0 at draft time, table design_orders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_orders_status;  -- unused_index, idx_scan=0 at draft time, table design_orders
DROP INDEX CONCURRENTLY IF EXISTS public.design_proof_versions_token_idx;  -- unused_index, idx_scan=0 at draft time, table design_proof_versions
DROP INDEX CONCURRENTLY IF EXISTS public.design_proofs_quality_status_idx;  -- unused_index, idx_scan=0 at draft time, table design_proofs
DROP INDEX CONCURRENTLY IF EXISTS public.design_proofs_source_catalogue_item_ids_gin;  -- unused_index, idx_scan=0 at draft time, table design_proofs
DROP INDEX CONCURRENTLY IF EXISTS public.design_proofs_status_idx;  -- unused_index, idx_scan=0 at draft time, table design_proofs
DROP INDEX CONCURRENTLY IF EXISTS public.design_snapshots_instance_idx;  -- unused_index, idx_scan=0 at draft time, table design_snapshots
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_snapshots_created_at;  -- unused_index, idx_scan=0 at draft time, table design_snapshots
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_snapshots_design_id;  -- unused_index, idx_scan=0 at draft time, table design_snapshots
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_snapshots_instance_view;  -- unused_index, idx_scan=0 at draft time, table design_snapshots
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_snapshots_view;  -- unused_index, idx_scan=0 at draft time, table design_snapshots
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_submissions_collection_id;  -- unused_index, idx_scan=0 at draft time, table design_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_submissions_company_id;  -- unused_index, idx_scan=0 at draft time, table design_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_submissions_customer_email;  -- unused_index, idx_scan=0 at draft time, table design_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_submissions_monday_subitem_id;  -- unused_index, idx_scan=0 at draft time, table design_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_submissions_status;  -- unused_index, idx_scan=0 at draft time, table design_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_design_submissions_submitted_at;  -- unused_index, idx_scan=0 at draft time, table design_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.designs_org_id_idx;  -- unused_index, idx_scan=0 at draft time, table designs
DROP INDEX CONCURRENTLY IF EXISTS public.epl_family_k_idx;  -- unused_index, idx_scan=0 at draft time, table embroidery_price_ladder_v1
DROP INDEX CONCURRENTLY IF EXISTS public.esr_lookup_idx;  -- unused_index, idx_scan=0 at draft time, table embroidery_setup_rules_v1
DROP INDEX CONCURRENTLY IF EXISTS public.idx_file_attachments_board;  -- unused_index, idx_scan=0 at draft time, table file_attachments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_finishes_active;  -- unused_index, idx_scan=0 at draft time, table finishes
DROP INDEX CONCURRENTLY IF EXISTS public.idx_finishes_type;  -- unused_index, idx_scan=0 at draft time, table finishes
DROP INDEX CONCURRENTLY IF EXISTS public.idx_folders_workspace;  -- unused_index, idx_scan=0 at draft time, table folders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_folders_workspace_position;  -- unused_index, idx_scan=0 at draft time, table folders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_generated_image_assets_created;  -- unused_index, idx_scan=0 at draft time, table generated_image_assets
DROP INDEX CONCURRENTLY IF EXISTS public.idx_generated_image_assets_destination_tags;  -- unused_index, idx_scan=0 at draft time, table generated_image_assets
DROP INDEX CONCURRENTLY IF EXISTS public.idx_generated_image_assets_user;  -- unused_index, idx_scan=0 at draft time, table generated_image_assets
DROP INDEX CONCURRENTLY IF EXISTS public.idx_generated_image_assets_workflow_status;  -- unused_index, idx_scan=0 at draft time, table generated_image_assets
DROP INDEX CONCURRENTLY IF EXISTS public.idx_generation_jobs_status;  -- unused_index, idx_scan=0 at draft time, table generation_jobs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_generation_jobs_user_id;  -- unused_index, idx_scan=0 at draft time, table generation_jobs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_generation_jobs_user_type;  -- unused_index, idx_scan=0 at draft time, table generation_jobs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_groups_board;  -- unused_index, idx_scan=0 at draft time, table groups
DROP INDEX CONCURRENTLY IF EXISTS public.idx_heatpress_rules_colors;  -- unused_index, idx_scan=0 at draft time, table heatpress_rules_v1
DROP INDEX CONCURRENTLY IF EXISTS public.idx_items_board;  -- unused_index, idx_scan=0 at draft time, table items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_items_group;  -- unused_index, idx_scan=0 at draft time, table items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_items_parent;  -- unused_index, idx_scan=0 at draft time, table items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_job_queue_cleanup;  -- unused_index, idx_scan=0 at draft time, table job_queue
DROP INDEX CONCURRENTLY IF EXISTS public.idx_job_queue_failed_jobs;  -- unused_index, idx_scan=0 at draft time, table job_queue
DROP INDEX CONCURRENTLY IF EXISTS public.idx_job_queue_worker;  -- unused_index, idx_scan=0 at draft time, table job_queue
DROP INDEX CONCURRENTLY IF EXISTS public.idx_job_tracker_webhook_logs_status;  -- unused_index, idx_scan=0 at draft time, table job_tracker_webhook_logs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_job_trackers_company_id;  -- unused_index, idx_scan=0 at draft time, table job_trackers
DROP INDEX CONCURRENTLY IF EXISTS public.idx_job_trackers_company_user;  -- unused_index, idx_scan=0 at draft time, table job_trackers
DROP INDEX CONCURRENTLY IF EXISTS public.idx_job_trackers_location_id;  -- unused_index, idx_scan=0 at draft time, table job_trackers
DROP INDEX CONCURRENTLY IF EXISTS public.idx_job_trackers_shopify_order_id;  -- unused_index, idx_scan=0 at draft time, table job_trackers
DROP INDEX CONCURRENTLY IF EXISTS public.job_trackers_monday_items_synced_at_idx;  -- unused_index, idx_scan=0 at draft time, table job_trackers
DROP INDEX CONCURRENTLY IF EXISTS public.idx_library_items_category;  -- unused_index, idx_scan=0 at draft time, table library_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_library_items_is_active;  -- unused_index, idx_scan=0 at draft time, table library_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_library_items_manufacturer;  -- unused_index, idx_scan=0 at draft time, table library_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_library_items_sub_category;  -- unused_index, idx_scan=0 at draft time, table library_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_migration_map_monday;  -- unused_index, idx_scan=0 at draft time, table monday_migration_map
DROP INDEX CONCURRENTLY IF EXISTS public.idx_migration_map_supabase;  -- unused_index, idx_scan=0 at draft time, table monday_migration_map
DROP INDEX CONCURRENTLY IF EXISTS public.idx_pricing_sync_monday;  -- unused_index, idx_scan=0 at draft time, table monday_pricing_sync
DROP INDEX CONCURRENTLY IF EXISTS public.idx_pricing_sync_source;  -- unused_index, idx_scan=0 at draft time, table monday_pricing_sync
DROP INDEX CONCURRENTLY IF EXISTS public.idx_monday_product_sync_item;  -- unused_index, idx_scan=0 at draft time, table monday_product_sync
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_user_unread;  -- unused_index, idx_scan=0 at draft time, table notifications
DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_account_id;  -- unused_index, idx_scan=0 at draft time, table orders
DROP INDEX CONCURRENTLY IF EXISTS public.orders_order_proof_approval_gate_idx;  -- unused_index, idx_scan=0 at draft time, table orders
DROP INDEX CONCURRENTLY IF EXISTS public.orders_period_idx;  -- unused_index, idx_scan=0 at draft time, table orders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_artwork_variants_stuck;  -- unused_index, idx_scan=0 at draft time, table organization_artwork_variants
DROP INDEX CONCURRENTLY IF EXISTS public.idx_organizations_domain;  -- unused_index, idx_scan=0 at draft time, table organizations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payments_quote;  -- unused_index, idx_scan=0 at draft time, table payments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_preorder_campaigns_active;  -- unused_index, idx_scan=0 at draft time, table preorder_campaigns
DROP INDEX CONCURRENTLY IF EXISTS public.idx_preorder_campaigns_collection;  -- unused_index, idx_scan=0 at draft time, table preorder_campaigns
DROP INDEX CONCURRENTLY IF EXISTS public.idx_preorder_campaigns_store;  -- unused_index, idx_scan=0 at draft time, table preorder_campaigns
DROP INDEX CONCURRENTLY IF EXISTS public.idx_preorder_stores_slug;  -- unused_index, idx_scan=0 at draft time, table preorder_stores
DROP INDEX CONCURRENTLY IF EXISTS public.idx_preorder_tracked_orders_campaign;  -- unused_index, idx_scan=0 at draft time, table preorder_tracked_orders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_preorder_tracked_orders_shopify;  -- unused_index, idx_scan=0 at draft time, table preorder_tracked_orders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_preorder_tracked_orders_status;  -- unused_index, idx_scan=0 at draft time, table preorder_tracked_orders
DROP INDEX CONCURRENTLY IF EXISTS public.idx_print_area_templates_category_view;  -- unused_index, idx_scan=0 at draft time, table print_area_templates
DROP INDEX CONCURRENTLY IF EXISTS public.idx_print_area_templates_default;  -- unused_index, idx_scan=0 at draft time, table print_area_templates
DROP INDEX CONCURRENTLY IF EXISTS public.product_images_ai_status_idx;  -- unused_index, idx_scan=0 at draft time, table product_images
DROP INDEX CONCURRENTLY IF EXISTS public.ix_ppt_qty_pick_by_product;  -- unused_index, idx_scan=0 at draft time, table product_pricing_tiers
DROP INDEX CONCURRENTLY IF EXISTS public.ix_ppt_qty_pick_by_sku;  -- unused_index, idx_scan=0 at draft time, table product_pricing_tiers
DROP INDEX CONCURRENTLY IF EXISTS public.product_print_areas_image_id_idx;  -- unused_index, idx_scan=0 at draft time, table product_print_areas
DROP INDEX CONCURRENTLY IF EXISTS public.product_print_areas_product_id_idx;  -- unused_index, idx_scan=0 at draft time, table product_print_areas
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_services_method_key;  -- unused_index, idx_scan=0 at draft time, table product_services
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_services_product_id;  -- unused_index, idx_scan=0 at draft time, table product_services
DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_sizes_link_product;  -- unused_index, idx_scan=0 at draft time, table product_sizes_link
DROP INDEX CONCURRENTLY IF EXISTS public.proof_amendment_requests_open_idx;  -- unused_index, idx_scan=0 at draft time, table proof_amendment_requests
DROP INDEX CONCURRENTLY IF EXISTS public.quote_items_size_id_idx;  -- unused_index, idx_scan=0 at draft time, table quote_items
DROP INDEX CONCURRENTLY IF EXISTS public.quote_items_subitem_idx;  -- unused_index, idx_scan=0 at draft time, table quote_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quote_submissions_company;  -- unused_index, idx_scan=0 at draft time, table quote_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quote_submissions_platform;  -- unused_index, idx_scan=0 at draft time, table quote_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quote_submissions_product;  -- unused_index, idx_scan=0 at draft time, table quote_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quote_submissions_submitted_at;  -- unused_index, idx_scan=0 at draft time, table quote_submissions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quotes_customer_email;  -- unused_index, idx_scan=0 at draft time, table quotes
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quotes_platform;  -- unused_index, idx_scan=0 at draft time, table quotes
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quotes_source;  -- unused_index, idx_scan=0 at draft time, table quotes
DROP INDEX CONCURRENTLY IF EXISTS public.idx_quotes_status;  -- unused_index, idx_scan=0 at draft time, table quotes
DROP INDEX CONCURRENTLY IF EXISTS public.quotes_cart_submission_id_idx;  -- unused_index, idx_scan=0 at draft time, table quotes
DROP INDEX CONCURRENTLY IF EXISTS public.quotes_order_ref_idx;  -- unused_index, idx_scan=0 at draft time, table quotes
DROP INDEX CONCURRENTLY IF EXISTS public.idx_spp_v2_active;  -- unused_index, idx_scan=0 at draft time, table screenprint_pricing_v2
DROP INDEX CONCURRENTLY IF EXISTS public.idx_screenprint_ladder_lookup;  -- unused_index, idx_scan=0 at draft time, table screenprint_rules_v1
DROP INDEX CONCURRENTLY IF EXISTS public.sr1_lookup;  -- unused_index, idx_scan=0 at draft time, table screenprint_rules_v1
DROP INDEX CONCURRENTLY IF EXISTS public.idx_service_pricing_rules_method_key_minqty;  -- unused_index, idx_scan=0 at draft time, table service_pricing_rules
DROP INDEX CONCURRENTLY IF EXISTS public.spr_display_name_trgm_idx;  -- unused_index, idx_scan=0 at draft time, table service_pricing_rules
DROP INDEX CONCURRENTLY IF EXISTS public.spr_qty_range_idx;  -- unused_index, idx_scan=0 at draft time, table service_pricing_rules
DROP INDEX CONCURRENTLY IF EXISTS public.idx_share_access_logs_share;  -- unused_index, idx_scan=0 at draft time, table share_access_logs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_share_comments_parent_id;  -- unused_index, idx_scan=0 at draft time, table share_comments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_share_comments_share;  -- unused_index, idx_scan=0 at draft time, table share_comments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_share_comments_tech_pack;  -- unused_index, idx_scan=0 at draft time, table share_comments
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sps_handle;  -- unused_index, idx_scan=0 at draft time, table shopify_product_sync
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sps_shopify;  -- unused_index, idx_scan=0 at draft time, table shopify_product_sync
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sps_status;  -- unused_index, idx_scan=0 at draft time, table shopify_product_sync
DROP INDEX CONCURRENTLY IF EXISTS public.idx_shopify_sessions_expires;  -- unused_index, idx_scan=0 at draft time, table shopify_sessions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_shopify_sessions_shop;  -- unused_index, idx_scan=0 at draft time, table shopify_sessions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staff_presentation_sections_presentation_id;  -- unused_index, idx_scan=0 at draft time, table staff_presentation_sections
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staff_presentations_status;  -- unused_index, idx_scan=0 at draft time, table staff_presentations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_staff_quotes_customer_email;  -- unused_index, idx_scan=0 at draft time, table staff_quotes
DROP INDEX CONCURRENTLY IF EXISTS public.staging_shopify_products_vendor_idx;  -- unused_index, idx_scan=0 at draft time, table staging_shopify_products
DROP INDEX CONCURRENTLY IF EXISTS public.idx_starshipit_webhook_logs_order;  -- unused_index, idx_scan=0 at draft time, table starshipit_webhook_logs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_starshipit_webhook_logs_tracking;  -- unused_index, idx_scan=0 at draft time, table starshipit_webhook_logs
DROP INDEX CONCURRENTLY IF EXISTS public.submission_keys_email_created_idx;  -- unused_index, idx_scan=0 at draft time, table submission_keys
DROP INDEX CONCURRENTLY IF EXISTS public.submission_keys_item_idx;  -- unused_index, idx_scan=0 at draft time, table submission_keys
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sij_status;  -- unused_index, idx_scan=0 at draft time, table supplier_import_jobs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_spr_category;  -- unused_index, idx_scan=0 at draft time, table supplier_price_rules
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_assets_tech_pack_id;  -- unused_index, idx_scan=0 at draft time, table tech_pack_assets
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_items_tech_pack_id;  -- unused_index, idx_scan=0 at draft time, table tech_pack_items
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_shares_pack_id;  -- unused_index, idx_scan=0 at draft time, table tech_pack_shares
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_shares_status;  -- unused_index, idx_scan=0 at draft time, table tech_pack_shares
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_shares_token;  -- unused_index, idx_scan=0 at draft time, table tech_pack_shares
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_shares_vendor;  -- unused_index, idx_scan=0 at draft time, table tech_pack_shares
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_pack_templates_category;  -- unused_index, idx_scan=0 at draft time, table tech_pack_templates
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_packs_status;  -- unused_index, idx_scan=0 at draft time, table tech_packs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tech_packs_user_id;  -- unused_index, idx_scan=0 at draft time, table tech_packs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tracker_email_log_email_sent;  -- unused_index, idx_scan=0 at draft time, table tracker_email_log
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tracker_email_log_monday_item_id;  -- unused_index, idx_scan=0 at draft time, table tracker_email_log
DROP INDEX CONCURRENTLY IF EXISTS public.user_onboarding_progress_updated_at_idx;  -- unused_index, idx_scan=0 at draft time, table user_onboarding_progress
DROP INDEX CONCURRENTLY IF EXISTS public.idx_user_orgs_default_store;  -- unused_index, idx_scan=0 at draft time, table user_organizations
DROP INDEX CONCURRENTLY IF EXISTS public.idx_view_generation_jobs_created_at;  -- unused_index, idx_scan=0 at draft time, table view_generation_jobs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_view_generation_jobs_status;  -- unused_index, idx_scan=0 at draft time, table view_generation_jobs
DROP INDEX CONCURRENTLY IF EXISTS public.idx_workspace_members_workspace;  -- unused_index, idx_scan=0 at draft time, table workspace_members


-- =====================================================================
-- ===== ROLLBACK =====
-- =====================================================================
-- Exact CREATE INDEX DDL for every index dropped above, obtained via
-- pg_get_indexdef(indexrelid) on 2026-07-14 and embedded verbatim
-- (CONCURRENTLY / IF NOT EXISTS added since the original defs came from
-- pg_get_indexdef, which never includes those clauses). Also cannot run
-- inside a transaction — apply one statement at a time. Same ordering
-- as FORWARD, for easy line-by-line pairing.

-- --- ROLLBACK: DUPLICATES (13) ---

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bom_items_tech_pack_id ON public.bom_items USING btree (tech_pack_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_snapshots_instance_id ON public.design_snapshots USING btree (instance_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_snapshots_instance_view ON public.design_snapshots USING btree (instance_id, view);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_quote_id ON public.payments USING btree (quote_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_ppt_by_product_option ON public.product_pricing_tiers USING btree (product_id, customization_value_id, min_quantity, tier_level) WHERE ((sku IS NULL) AND (customization_value_id IS NOT NULL));
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_ppt_by_product_no_sku_no_cvid ON public.product_pricing_tiers USING btree (product_id, min_quantity, tier_level) WHERE ((sku IS NULL) AND (customization_value_id IS NULL));
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_ppt_by_sku_with_cvid ON public.product_pricing_tiers USING btree (sku, customization_value_id, min_quantity, tier_level) WHERE ((sku IS NOT NULL) AND (customization_value_id IS NOT NULL));
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_ppt_by_sku_no_cvid ON public.product_pricing_tiers USING btree (sku, min_quantity, tier_level) WHERE ((sku IS NOT NULL) AND (customization_value_id IS NULL));
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_product_sizes_link_product ON public.product_sizes_link USING btree (product_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_access_logs_share_id ON public.share_access_logs USING btree (share_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_comments_share_id ON public.share_comments USING btree (share_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_shares_tech_pack ON public.tech_pack_shares USING btree (tech_pack_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_shares_vendor_id ON public.tech_pack_shares USING btree (vendor_id);

-- --- ROLLBACK: UNUSED (185) ---

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_requests_created_at ON public.account_requests USING btree (created_at DESC);  -- restores dropped unused index on account_requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_requests_email ON public.account_requests USING btree (email);  -- restores dropped unused index on account_requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_requests_platform ON public.account_requests USING btree (platform);  -- restores dropped unused index on account_requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_requests_status ON public.account_requests USING btree (status);  -- restores dropped unused index on account_requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_requests_supabase_user_id ON public.account_requests USING btree (supabase_user_id);  -- restores dropped unused index on account_requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_board ON public.activities USING btree (board_id);  -- restores dropped unused index on activities
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_item ON public.activities USING btree (item_id);  -- restores dropped unused index on activities
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_generation_history_type ON public.ai_generation_history USING btree (type);  -- restores dropped unused index on ai_generation_history
CREATE INDEX CONCURRENTLY IF NOT EXISTS b2b_accounts_account_manager_id_idx ON public.b2b_accounts USING btree (account_manager_id) WHERE (account_manager_id IS NOT NULL);  -- restores dropped unused index on b2b_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_accounts_platform ON public.b2b_accounts USING btree (platform);  -- restores dropped unused index on b2b_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS b2b_catalogue_item_decorations_decoration_idx ON public.b2b_catalogue_item_decorations USING btree (org_decoration_id);  -- restores dropped unused index on b2b_catalogue_item_decorations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_relation_links_relation ON public.board_relation_links USING btree (relation_id);  -- restores dropped unused index on board_relation_links
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_relation_links_source ON public.board_relation_links USING btree (source_item_id);  -- restores dropped unused index on board_relation_links
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_relation_links_target ON public.board_relation_links USING btree (target_item_id);  -- restores dropped unused index on board_relation_links
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_relations_column ON public.board_relations USING btree (source_column_id);  -- restores dropped unused index on board_relations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_relations_source ON public.board_relations USING btree (source_board_id);  -- restores dropped unused index on board_relations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_relations_target ON public.board_relations USING btree (target_board_id);  -- restores dropped unused index on board_relations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_templates_category ON public.board_templates USING btree (category);  -- restores dropped unused index on board_templates
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_board_views_board ON public.board_views USING btree (board_id);  -- restores dropped unused index on board_views
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boards_folder ON public.boards USING btree (folder_id);  -- restores dropped unused index on boards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boards_workspace ON public.boards USING btree (workspace_id);  -- restores dropped unused index on boards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bom_items_category ON public.bom_items USING btree (category);  -- restores dropped unused index on bom_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bom_items_library_item ON public.bom_items USING btree (library_item_id);  -- restores dropped unused index on bom_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bom_items_tech_pack ON public.bom_items USING btree (tech_pack_id);  -- restores dropped unused index on bom_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brands_hero_product ON public.brands USING btree (hero_product_id) WHERE (hero_product_id IS NOT NULL);  -- restores dropped unused index on brands
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brands_platform ON public.brands USING btree (platform);  -- restores dropped unused index on brands
CREATE INDEX CONCURRENTLY IF NOT EXISTS brief_items_brief_idx ON public.brief_items USING btree (brief_id);  -- restores dropped unused index on brief_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS briefs_anon_token_idx ON public.briefs USING btree (anon_token);  -- restores dropped unused index on briefs
CREATE INDEX CONCURRENTLY IF NOT EXISTS briefs_share_token_idx ON public.briefs USING btree (share_token);  -- restores dropped unused index on briefs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_business_rules_active ON public.business_rules USING btree (is_active) WHERE (is_active = true);  -- restores dropped unused index on business_rules
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_hero_product ON public.categories USING btree (hero_product_id) WHERE (hero_product_id IS NOT NULL);  -- restores dropped unused index on categories
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_platform ON public.categories USING btree (platform);  -- restores dropped unused index on categories
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_type ON public.categories USING btree (category_type);  -- restores dropped unused index on categories
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cell_values_column ON public.cell_values USING btree (column_id);  -- restores dropped unused index on cell_values
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cell_values_item ON public.cell_values USING btree (item_id);  -- restores dropped unused index on cell_values
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_conversations_open_idx ON public.chat_conversations USING btree (status) WHERE (status <> 'resolved'::text);  -- restores dropped unused index on chat_conversations
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_conversations_owner_idx ON public.chat_conversations USING btree (owner_id);  -- restores dropped unused index on chat_conversations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_columns_board ON public.columns USING btree (board_id);  -- restores dropped unused index on columns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_board ON public.comments USING btree (board_id);  -- restores dropped unused index on comments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_item ON public.comments USING btree (item_id);  -- restores dropped unused index on comments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_parent ON public.comments USING btree (parent_id);  -- restores dropped unused index on comments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decoration_locations_active ON public.decoration_locations USING btree (is_active);  -- restores dropped unused index on decoration_locations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_collections_company_id ON public.design_collections USING btree (company_id);  -- restores dropped unused index on design_collections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_collections_created_at ON public.design_collections USING btree (created_at DESC);  -- restores dropped unused index on design_collections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_collections_customer_email ON public.design_collections USING btree (customer_email);  -- restores dropped unused index on design_collections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_collections_monday_item_id ON public.design_collections USING btree (monday_item_id);  -- restores dropped unused index on design_collections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_collections_quote_id ON public.design_collections USING btree (quote_id);  -- restores dropped unused index on design_collections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_collections_status ON public.design_collections USING btree (status);  -- restores dropped unused index on design_collections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_drafts_product ON public.design_drafts USING btree (product_id);  -- restores dropped unused index on design_drafts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_orders_email ON public.design_orders USING btree (customer_email);  -- restores dropped unused index on design_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_orders_platform ON public.design_orders USING btree (platform);  -- restores dropped unused index on design_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_orders_shopify ON public.design_orders USING btree (shopify_order_id);  -- restores dropped unused index on design_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_orders_shopify_order_id ON public.design_orders USING btree (shopify_order_id) WHERE (shopify_order_id IS NOT NULL);  -- restores dropped unused index on design_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_orders_status ON public.design_orders USING btree (status);  -- restores dropped unused index on design_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS design_proof_versions_token_idx ON public.design_proof_versions USING btree (approval_token_hash) WHERE (approval_token_hash IS NOT NULL);  -- restores dropped unused index on design_proof_versions
CREATE INDEX CONCURRENTLY IF NOT EXISTS design_proofs_quality_status_idx ON public.design_proofs USING btree (proof_quality_status);  -- restores dropped unused index on design_proofs
CREATE INDEX CONCURRENTLY IF NOT EXISTS design_proofs_source_catalogue_item_ids_gin ON public.design_proofs USING gin (source_catalogue_item_ids);  -- restores dropped unused index on design_proofs
CREATE INDEX CONCURRENTLY IF NOT EXISTS design_proofs_status_idx ON public.design_proofs USING btree (status);  -- restores dropped unused index on design_proofs
CREATE INDEX CONCURRENTLY IF NOT EXISTS design_snapshots_instance_idx ON public.design_snapshots USING btree (instance_id);  -- restores dropped unused index on design_snapshots
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_snapshots_created_at ON public.design_snapshots USING btree (created_at);  -- restores dropped unused index on design_snapshots
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_snapshots_design_id ON public.design_snapshots USING btree (design_id) WHERE (design_id IS NOT NULL);  -- restores dropped unused index on design_snapshots
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_snapshots_instance_view ON public.design_snapshots USING btree (instance_id, view);  -- restores dropped unused index on design_snapshots
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_snapshots_view ON public.design_snapshots USING btree (view);  -- restores dropped unused index on design_snapshots
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_submissions_collection_id ON public.design_submissions USING btree (collection_id);  -- restores dropped unused index on design_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_submissions_company_id ON public.design_submissions USING btree (company_id);  -- restores dropped unused index on design_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_submissions_customer_email ON public.design_submissions USING btree (customer_email);  -- restores dropped unused index on design_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_submissions_monday_subitem_id ON public.design_submissions USING btree (monday_subitem_id);  -- restores dropped unused index on design_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_submissions_status ON public.design_submissions USING btree (status);  -- restores dropped unused index on design_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_submissions_submitted_at ON public.design_submissions USING btree (submitted_at DESC);  -- restores dropped unused index on design_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS designs_org_id_idx ON public.designs USING btree (org_id);  -- restores dropped unused index on designs
CREATE INDEX CONCURRENTLY IF NOT EXISTS epl_family_k_idx ON public.embroidery_price_ladder_v1 USING btree (garment_family, min_k, max_k);  -- restores dropped unused index on embroidery_price_ladder_v1
CREATE INDEX CONCURRENTLY IF NOT EXISTS esr_lookup_idx ON public.embroidery_setup_rules_v1 USING btree (complexity, garment_family, min_k, max_k);  -- restores dropped unused index on embroidery_setup_rules_v1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_attachments_board ON public.file_attachments USING btree (board_id);  -- restores dropped unused index on file_attachments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finishes_active ON public.finishes USING btree (is_active);  -- restores dropped unused index on finishes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finishes_type ON public.finishes USING btree (finish_type);  -- restores dropped unused index on finishes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folders_workspace ON public.folders USING btree (workspace_id);  -- restores dropped unused index on folders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folders_workspace_position ON public.folders USING btree (workspace_id, "position");  -- restores dropped unused index on folders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generated_image_assets_created ON public.generated_image_assets USING btree (created_at DESC);  -- restores dropped unused index on generated_image_assets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generated_image_assets_destination_tags ON public.generated_image_assets USING gin (destination_tags);  -- restores dropped unused index on generated_image_assets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generated_image_assets_user ON public.generated_image_assets USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);  -- restores dropped unused index on generated_image_assets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generated_image_assets_workflow_status ON public.generated_image_assets USING btree (workflow_type, status, created_at DESC);  -- restores dropped unused index on generated_image_assets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_status ON public.generation_jobs USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));  -- restores dropped unused index on generation_jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_user_id ON public.generation_jobs USING btree (user_id) WHERE (user_id IS NOT NULL);  -- restores dropped unused index on generation_jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_user_type ON public.generation_jobs USING btree (user_id, job_type, created_at DESC) WHERE (user_id IS NOT NULL);  -- restores dropped unused index on generation_jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_groups_board ON public.groups USING btree (board_id);  -- restores dropped unused index on groups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_heatpress_rules_colors ON public.heatpress_rules_v1 USING btree (size_code, colors);  -- restores dropped unused index on heatpress_rules_v1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_board ON public.items USING btree (board_id);  -- restores dropped unused index on items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_group ON public.items USING btree (group_id);  -- restores dropped unused index on items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_parent ON public.items USING btree (parent_item_id);  -- restores dropped unused index on items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_queue_cleanup ON public.job_queue USING btree (status, completed_at) WHERE (status = ANY (ARRAY['completed'::text, 'failed'::text, 'cancelled'::text]));  -- restores dropped unused index on job_queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_queue_failed_jobs ON public.job_queue USING btree (type, created_at DESC) WHERE (status = 'failed'::text);  -- restores dropped unused index on job_queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_queue_worker ON public.job_queue USING btree (worker_id, status) WHERE (worker_id IS NOT NULL);  -- restores dropped unused index on job_queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_tracker_webhook_logs_status ON public.job_tracker_webhook_logs USING btree (status);  -- restores dropped unused index on job_tracker_webhook_logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_trackers_company_id ON public.job_trackers USING btree (company_id);  -- restores dropped unused index on job_trackers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_trackers_company_user ON public.job_trackers USING btree (company_id, user_id);  -- restores dropped unused index on job_trackers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_trackers_location_id ON public.job_trackers USING btree (location_id);  -- restores dropped unused index on job_trackers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_trackers_shopify_order_id ON public.job_trackers USING btree (shopify_order_id);  -- restores dropped unused index on job_trackers
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_trackers_monday_items_synced_at_idx ON public.job_trackers USING btree (monday_items_synced_at);  -- restores dropped unused index on job_trackers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_items_category ON public.library_items USING btree (category);  -- restores dropped unused index on library_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_items_is_active ON public.library_items USING btree (is_active);  -- restores dropped unused index on library_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_items_manufacturer ON public.library_items USING btree (manufacturer_id);  -- restores dropped unused index on library_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_items_sub_category ON public.library_items USING btree (sub_category);  -- restores dropped unused index on library_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_migration_map_monday ON public.monday_migration_map USING btree (monday_type, monday_id);  -- restores dropped unused index on monday_migration_map
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_migration_map_supabase ON public.monday_migration_map USING btree (supabase_id);  -- restores dropped unused index on monday_migration_map
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pricing_sync_monday ON public.monday_pricing_sync USING btree (monday_board_id, monday_item_id);  -- restores dropped unused index on monday_pricing_sync
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pricing_sync_source ON public.monday_pricing_sync USING btree (source_table, source_id);  -- restores dropped unused index on monday_pricing_sync
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_monday_product_sync_item ON public.monday_product_sync USING btree (monday_item_id);  -- restores dropped unused index on monday_product_sync
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (is_read = false);  -- restores dropped unused index on notifications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_account_id ON public.orders USING btree (account_id);  -- restores dropped unused index on orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_order_proof_approval_gate_idx ON public.orders USING btree (order_proof_approval_gate) WHERE (order_proof_approval_gate = 'approved'::text);  -- restores dropped unused index on orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_period_idx ON public.orders USING btree (period_id) WHERE (period_id IS NOT NULL);  -- restores dropped unused index on orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_artwork_variants_stuck ON public.organization_artwork_variants USING btree (status, started_at) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));  -- restores dropped unused index on organization_artwork_variants
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_domain ON public.organizations USING btree (domain);  -- restores dropped unused index on organizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_quote ON public.payments USING btree (quote_id);  -- restores dropped unused index on payments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preorder_campaigns_active ON public.preorder_campaigns USING btree (active) WHERE (active = true);  -- restores dropped unused index on preorder_campaigns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preorder_campaigns_collection ON public.preorder_campaigns USING btree (collection_handle);  -- restores dropped unused index on preorder_campaigns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preorder_campaigns_store ON public.preorder_campaigns USING btree (store_id);  -- restores dropped unused index on preorder_campaigns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preorder_stores_slug ON public.preorder_stores USING btree (slug) WHERE (is_active = true);  -- restores dropped unused index on preorder_stores
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preorder_tracked_orders_campaign ON public.preorder_tracked_orders USING btree (campaign_id);  -- restores dropped unused index on preorder_tracked_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preorder_tracked_orders_shopify ON public.preorder_tracked_orders USING btree (shopify_order_id);  -- restores dropped unused index on preorder_tracked_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preorder_tracked_orders_status ON public.preorder_tracked_orders USING btree (status);  -- restores dropped unused index on preorder_tracked_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_print_area_templates_category_view ON public.print_area_templates USING btree (category, view);  -- restores dropped unused index on print_area_templates
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_print_area_templates_default ON public.print_area_templates USING btree (category, view, is_default) WHERE (is_default = true);  -- restores dropped unused index on print_area_templates
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_images_ai_status_idx ON public.product_images USING btree (ai_status) WHERE (ai_status IS NOT NULL);  -- restores dropped unused index on product_images
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ppt_qty_pick_by_product ON public.product_pricing_tiers USING btree (product_id, min_quantity, COALESCE(max_quantity, 2147483647)) WHERE (sku IS NULL);  -- restores dropped unused index on product_pricing_tiers
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ppt_qty_pick_by_sku ON public.product_pricing_tiers USING btree (sku, min_quantity, COALESCE(max_quantity, 2147483647)) WHERE (sku IS NOT NULL);  -- restores dropped unused index on product_pricing_tiers
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_print_areas_image_id_idx ON public.product_print_areas USING btree (image_id);  -- restores dropped unused index on product_print_areas
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_print_areas_product_id_idx ON public.product_print_areas USING btree (product_id);  -- restores dropped unused index on product_print_areas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_services_method_key ON public.product_services USING btree (method_key);  -- restores dropped unused index on product_services
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_services_product_id ON public.product_services USING btree (product_id);  -- restores dropped unused index on product_services
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_sizes_link_product ON public.product_sizes_link USING btree (product_id);  -- restores dropped unused index on product_sizes_link
CREATE INDEX CONCURRENTLY IF NOT EXISTS proof_amendment_requests_open_idx ON public.proof_amendment_requests USING btree (status) WHERE (status = ANY (ARRAY['open'::text, 'in-progress'::text]));  -- restores dropped unused index on proof_amendment_requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS quote_items_size_id_idx ON public.quote_items USING btree (size_id);  -- restores dropped unused index on quote_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS quote_items_subitem_idx ON public.quote_items USING btree (monday_subitem_id) WHERE (monday_subitem_id IS NOT NULL);  -- restores dropped unused index on quote_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quote_submissions_company ON public.quote_submissions USING btree (company_name);  -- restores dropped unused index on quote_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quote_submissions_platform ON public.quote_submissions USING btree (platform);  -- restores dropped unused index on quote_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quote_submissions_product ON public.quote_submissions USING btree (product_id);  -- restores dropped unused index on quote_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quote_submissions_submitted_at ON public.quote_submissions USING btree (submitted_at);  -- restores dropped unused index on quote_submissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotes_customer_email ON public.quotes USING btree (customer_email);  -- restores dropped unused index on quotes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotes_platform ON public.quotes USING btree (platform);  -- restores dropped unused index on quotes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotes_source ON public.quotes USING btree (source);  -- restores dropped unused index on quotes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotes_status ON public.quotes USING btree (status);  -- restores dropped unused index on quotes
CREATE INDEX CONCURRENTLY IF NOT EXISTS quotes_cart_submission_id_idx ON public.quotes USING btree (cart_submission_id) WHERE (cart_submission_id IS NOT NULL);  -- restores dropped unused index on quotes
CREATE INDEX CONCURRENTLY IF NOT EXISTS quotes_order_ref_idx ON public.quotes USING btree (order_ref) WHERE (order_ref IS NOT NULL);  -- restores dropped unused index on quotes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spp_v2_active ON public.screenprint_pricing_v2 USING btree (active);  -- restores dropped unused index on screenprint_pricing_v2
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenprint_ladder_lookup ON public.screenprint_rules_v1 USING btree (placement, total_colors, currency, min_qty, max_qty);  -- restores dropped unused index on screenprint_rules_v1
CREATE INDEX CONCURRENTLY IF NOT EXISTS sr1_lookup ON public.screenprint_rules_v1 USING btree (placement, total_colors, min_qty, max_qty);  -- restores dropped unused index on screenprint_rules_v1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_pricing_rules_method_key_minqty ON public.service_pricing_rules USING btree (method_key, min_qty);  -- restores dropped unused index on service_pricing_rules
CREATE INDEX CONCURRENTLY IF NOT EXISTS spr_display_name_trgm_idx ON public.service_pricing_rules USING gin (display_name gin_trgm_ops);  -- restores dropped unused index on service_pricing_rules
CREATE INDEX CONCURRENTLY IF NOT EXISTS spr_qty_range_idx ON public.service_pricing_rules USING btree (min_qty, COALESCE(max_qty, 2147483647));  -- restores dropped unused index on service_pricing_rules
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_access_logs_share ON public.share_access_logs USING btree (share_id);  -- restores dropped unused index on share_access_logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_comments_parent_id ON public.share_comments USING btree (parent_comment_id);  -- restores dropped unused index on share_comments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_comments_share ON public.share_comments USING btree (share_id);  -- restores dropped unused index on share_comments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_share_comments_tech_pack ON public.share_comments USING btree (tech_pack_id);  -- restores dropped unused index on share_comments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sps_handle ON public.shopify_product_sync USING btree (shopify_handle);  -- restores dropped unused index on shopify_product_sync
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sps_shopify ON public.shopify_product_sync USING btree (shopify_product_id) WHERE (shopify_product_id IS NOT NULL);  -- restores dropped unused index on shopify_product_sync
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sps_status ON public.shopify_product_sync USING btree (sync_status) WHERE (sync_status <> 'synced'::text);  -- restores dropped unused index on shopify_product_sync
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shopify_sessions_expires ON public.shopify_sessions USING btree (expires_at);  -- restores dropped unused index on shopify_sessions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shopify_sessions_shop ON public.shopify_sessions USING btree (shop);  -- restores dropped unused index on shopify_sessions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_presentation_sections_presentation_id ON public.staff_presentation_sections USING btree (presentation_id);  -- restores dropped unused index on staff_presentation_sections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_presentations_status ON public.staff_presentations USING btree (status);  -- restores dropped unused index on staff_presentations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_quotes_customer_email ON public.staff_quotes USING btree (customer_email);  -- restores dropped unused index on staff_quotes
CREATE INDEX CONCURRENTLY IF NOT EXISTS staging_shopify_products_vendor_idx ON public.staging_shopify_products USING btree (vendor);  -- restores dropped unused index on staging_shopify_products
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_starshipit_webhook_logs_order ON public.starshipit_webhook_logs USING btree (order_number);  -- restores dropped unused index on starshipit_webhook_logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_starshipit_webhook_logs_tracking ON public.starshipit_webhook_logs USING btree (tracking_number);  -- restores dropped unused index on starshipit_webhook_logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS submission_keys_email_created_idx ON public.submission_keys USING btree (email, created_at DESC);  -- restores dropped unused index on submission_keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS submission_keys_item_idx ON public.submission_keys USING btree (monday_item_id);  -- restores dropped unused index on submission_keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sij_status ON public.supplier_import_jobs USING btree (status) WHERE (status <> 'completed'::text);  -- restores dropped unused index on supplier_import_jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spr_category ON public.supplier_price_rules USING btree (category_id);  -- restores dropped unused index on supplier_price_rules
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_assets_tech_pack_id ON public.tech_pack_assets USING btree (tech_pack_id);  -- restores dropped unused index on tech_pack_assets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_items_tech_pack_id ON public.tech_pack_items USING btree (tech_pack_id);  -- restores dropped unused index on tech_pack_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_shares_pack_id ON public.tech_pack_shares USING btree (tech_pack_id);  -- restores dropped unused index on tech_pack_shares
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_shares_status ON public.tech_pack_shares USING btree (status);  -- restores dropped unused index on tech_pack_shares
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_shares_token ON public.tech_pack_shares USING btree (token);  -- restores dropped unused index on tech_pack_shares
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_shares_vendor ON public.tech_pack_shares USING btree (vendor_id);  -- restores dropped unused index on tech_pack_shares
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_pack_templates_category ON public.tech_pack_templates USING btree (category);  -- restores dropped unused index on tech_pack_templates
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_packs_status ON public.tech_packs USING btree (status);  -- restores dropped unused index on tech_packs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_packs_user_id ON public.tech_packs USING btree (user_id);  -- restores dropped unused index on tech_packs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracker_email_log_email_sent ON public.tracker_email_log USING btree (email_sent, sent_at);  -- restores dropped unused index on tracker_email_log
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracker_email_log_monday_item_id ON public.tracker_email_log USING btree (monday_item_id);  -- restores dropped unused index on tracker_email_log
CREATE INDEX CONCURRENTLY IF NOT EXISTS user_onboarding_progress_updated_at_idx ON public.user_onboarding_progress USING btree (updated_at DESC);  -- restores dropped unused index on user_onboarding_progress
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_orgs_default_store ON public.user_organizations USING btree (default_store_id) WHERE (default_store_id IS NOT NULL);  -- restores dropped unused index on user_organizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_view_generation_jobs_created_at ON public.view_generation_jobs USING btree (created_at DESC);  -- restores dropped unused index on view_generation_jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_view_generation_jobs_status ON public.view_generation_jobs USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));  -- restores dropped unused index on view_generation_jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_members_workspace ON public.workspace_members USING btree (workspace_id);  -- restores dropped unused index on workspace_members
