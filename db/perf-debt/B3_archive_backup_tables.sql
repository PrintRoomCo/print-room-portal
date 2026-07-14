-- ============================================================================
-- B3 — Move backup/scratch tables out of the API-exposed `public` schema
-- Date: 2026-07-14 | STAGED FOR REVIEW — DO NOT APPLY without explicit
-- sign-off. This project has NO Supabase branching; apply manually via the
-- SQL editor/psql after review. SHIP AS ITS OWN URGENT ITEM — this is a
-- security fix (anon-key PII exposure) wearing a perf hat.
--
-- Verified evidence (2026-07-14):
--   * 101 backup/scratch tables in public (100 matching bak|backup + the
--     demo_rewire_map_20260611 scratch table); 97 + 1 have RLS DISABLED and
--     are readable with the storefront anon key via PostgREST.
--   * They also bloat the PostgREST schema cache (101 of 294 public tables).
--
-- Approach: move to a private `archive` schema. PostgREST only exposes
-- `public` (and graphql_public), so this removes API reachability AND
-- shrinks the schema cache without dropping any data. Data is untouched.
--
-- PRE-APPLY VERIFICATION (run first; all must return 0 rows). Both checks
-- were run at staging time (2026-07-14) and returned 0 rows — re-run at
-- apply time in case new objects appeared since:
--   1. Nothing else references these tables (views/matviews/FKs/functions):
--      select distinct dependent_ns.nspname, dependent.relname
--      from pg_depend d
--      join pg_rewrite r on r.oid = d.objid
--      join pg_class dependent on dependent.oid = r.ev_class
--      join pg_namespace dependent_ns on dependent_ns.oid = dependent.relnamespace
--      join pg_class ref on ref.oid = d.refobjid
--      where ref.relname ~* 'bak|backup|demo_rewire_map'
--        and dependent.relname !~* 'bak|backup|demo_rewire_map';
--      select conname, conrelid::regclass from pg_constraint
--      where confrelid::regclass::text ~* 'bak|backup|demo_rewire_map'
--        and conrelid::regclass::text !~* 'bak|backup|demo_rewire_map';
--   2. Neither portal references any of these table names in code
--      (verified 2026-07-14: no hits in print-room-portal or
--      print-room-staff-portal outside migrations).
--
-- Post-apply: PostgREST reloads its schema cache automatically on DDL; if
-- stale, NOTIFY pgrst, 'reload schema';
-- ============================================================================

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
alter table public._backup_embroidery_setup_rules_v1_20260605 set schema archive;
alter table public._backup_user_organizations_role_pre_buyer_roles set schema archive;
alter table public.b2b_account_managers_orgnuke_bak_20260612 set schema archive;
alter table public.b2b_accounts_orgnuke_bak_20260612 set schema archive;
alter table public.b2b_cat_item_dec_pubbackfill_bak_20260618 set schema archive;
alter table public.b2b_cat_item_img_pubbackfill_bak_20260618 set schema archive;
alter table public.b2b_catalogue_item_colors_crewsocksmerge_bak_20260630 set schema archive;
alter table public.b2b_catalogue_item_colors_junk_bak_20260605 set schema archive;
alter table public.b2b_catalogue_item_colors_straytest_bak_20260611 set schema archive;
alter table public.b2b_catalogue_item_decorations_crewsocksmerge_bak_20260630 set schema archive;
alter table public.b2b_catalogue_item_decorations_junk_bak_20260605 set schema archive;
alter table public.b2b_catalogue_item_decorations_orgnuke_bak_20260612 set schema archive;
alter table public.b2b_catalogue_item_images_crewsocksmerge_bak_20260630 set schema archive;
alter table public.b2b_catalogue_item_images_dedupe_bak_20260618 set schema archive;
alter table public.b2b_catalogue_item_images_heroflip_bak_20260606 set schema archive;
alter table public.b2b_catalogue_item_images_junk_bak_20260605 set schema archive;
alter table public.b2b_catalogue_item_images_straytest_bak_20260611 set schema archive;
alter table public.b2b_catalogue_item_pricing_tiers_crewsocksmerge_bak_20260630 set schema archive;
alter table public.b2b_catalogue_items_crewsocksmerge_bak_20260630 set schema archive;
alter table public.b2b_catalogue_items_demorewire_bak_20260611 set schema archive;
alter table public.b2b_catalogue_items_nuke_bak_20260612 set schema archive;
alter table public.b2b_catalogue_items_orgnuke_bak_20260612 set schema archive;
alter table public.b2b_catalogue_items_preorderdesc_bak_20260630 set schema archive;
alter table public.b2b_catalogues_orgnuke_bak_20260612 set schema archive;
alter table public.b2b_ordering_period_item_pricing_anytimefit_bak_20260626 set schema archive;
alter table public.b2b_ordering_period_item_pricing_nuke_bak_20260612 set schema archive;
alter table public.b2b_ordering_periods_anytimefit_bak_20260626 set schema archive;
alter table public.b2b_ordering_periods_orgnuke_bak_20260612 set schema archive;
alter table public.brands_bak_20260629 set schema archive;
alter table public.brands_brandmerge_bak_20260629 set schema archive;
alter table public.categories_bak_20260629 set schema archive;
alter table public.chat_conversations_chatv0_bak_20260713 set schema archive;
alter table public.chat_messages_chatv0_bak_20260713 set schema archive;
alter table public.chat_users_chatv0_bak_20260713 set schema archive;
alter table public.demo_rewire_map_20260611 set schema archive;
alter table public.design_artwork_orgnuke_bak_20260612 set schema archive;
alter table public.design_proof_versions_orgnuke_bak_20260612 set schema archive;
alter table public.design_proofs_orgnuke_bak_20260612 set schema archive;
alter table public.designs_orgnuke_bak_20260612 set schema archive;
alter table public.embroidery_price_ladder_v1_backup_20251110 set schema archive;
alter table public.job_trackers_anytime79_bak_20260701 set schema archive;
alter table public.job_trackers_anytimefit_bak_20260626 set schema archive;
alter table public.job_trackers_anytimetest_bak_20260701 set schema archive;
alter table public.job_trackers_demo_bak_20260701 set schema archive;
alter table public.order_email_log_anytime79_bak_20260701 set schema archive;
alter table public.order_email_log_anytimefit_bak_20260626 set schema archive;
alter table public.order_email_log_anytimetest_bak_20260701 set schema archive;
alter table public.order_email_log_orgnuke_bak_20260612 set schema archive;
alter table public.order_extras_orgnuke_bak_20260612 set schema archive;
alter table public.orders_anytime79_bak_20260701 set schema archive;
alter table public.orders_anytimefit_bak_20260626 set schema archive;
alter table public.orders_anytimetest_bak_20260701 set schema archive;
alter table public.orders_orgnuke_bak_20260612 set schema archive;
alter table public.org_decorations_orgnuke_bak_20260612 set schema archive;
alter table public.organization_artwork_variants_orgnuke_bak_20260612 set schema archive;
alter table public.organization_artworks_orgnuke_bak_20260612 set schema archive;
alter table public.organizations_orgnuke_bak_20260612 set schema archive;
alter table public.product_color_swatches_ascolour_bak_20260609 set schema archive;
alter table public.product_color_swatches_bcdead_bak_20260609 set schema archive;
alter table public.product_color_swatches_gymduffel_bak_20260629 set schema archive;
alter table public.product_color_swatches_imgcolourlink_bak_20260606 set schema archive;
alter table public.product_color_swatches_junk_bak_20260605 set schema archive;
alter table public.product_color_swatches_nuke_bak_20260612 set schema archive;
alter table public.product_color_swatches_straytest_bak_20260611 set schema archive;
alter table public.product_images_ascolour_bak_20260609 set schema archive;
alter table public.product_images_ascolour_relink_bak_20260605 set schema archive;
alter table public.product_images_bcdead_bak_20260609 set schema archive;
alter table public.product_images_dupe_bak_20260605 set schema archive;
alter table public.product_images_ecrubackfix_bak_20260619 set schema archive;
alter table public.product_images_frontrekey_bak_20260710 set schema archive;
alter table public.product_images_gymduffel_bak_20260629 set schema archive;
alter table public.product_images_heroflip_bak_20260606 set schema archive;
alter table public.product_images_imgcolourlink_bak_20260606 set schema archive;
alter table public.product_images_nuke_bak_20260612 set schema archive;
alter table public.product_pricing_tiers_backup_tshirt_20260119 set schema archive;
alter table public.product_variants_ascolour_bak_20260609 set schema archive;
alter table public.product_variants_mtobackfill2_bak_20260629 set schema archive;
alter table public.product_variants_mtobackfill_bak_20260629 set schema archive;
alter table public.product_variants_nuke_bak_20260612 set schema archive;
alter table public.products_ascolour_bak_20260609 set schema archive;
alter table public.products_brandfix_bak_20260629 set schema archive;
alter table public.products_brandmerge_bak_20260629 set schema archive;
alter table public.products_nuke_bak_20260612 set schema archive;
alter table public.quote_items_anytime79_bak_20260701 set schema archive;
alter table public.quote_items_anytimeq_bak_20260701 set schema archive;
alter table public.quote_items_anytimetest_bak_20260701 set schema archive;
alter table public.quote_items_crewsocksmerge_bak_20260630 set schema archive;
alter table public.quote_items_nuke_bak_20260612 set schema archive;
alter table public.quote_items_orgnuke_bak_20260612 set schema archive;
alter table public.quotes_anytime79_bak_20260701 set schema archive;
alter table public.quotes_anytimeq_bak_20260701 set schema archive;
alter table public.quotes_anytimetest_bak_20260701 set schema archive;
alter table public.quotes_orgnuke_bak_20260612 set schema archive;
alter table public.staging_shopify_companies_orgnuke_bak_20260612 set schema archive;
alter table public.staging_shopify_matches_nuke_bak_20260612 set schema archive;
alter table public.stores_orgnuke_bak_20260612 set schema archive;
alter table public.user_organizations_orgnuke_bak_20260612 set schema archive;
alter table public.variant_inventory_anytimeteesize_bak_20260625 set schema archive;
alter table public.variant_inventory_events_anytimetest_bak_20260701 set schema archive;
alter table public.variant_inventory_events_nuke_bak_20260612 set schema archive;
alter table public.variant_inventory_orgnuke_bak_20260612 set schema archive;

-- ============================= ROLLBACK =====================================
-- Moves every table back to public exactly as it was. (RLS flags and grants
-- travel with the table, so the prior state is fully restored. The archive
-- schema itself is left in place; drop it manually once empty if desired.)
-- alter table archive._backup_embroidery_setup_rules_v1_20260605 set schema public;
-- alter table archive._backup_user_organizations_role_pre_buyer_roles set schema public;
-- alter table archive.b2b_account_managers_orgnuke_bak_20260612 set schema public;
-- alter table archive.b2b_accounts_orgnuke_bak_20260612 set schema public;
-- alter table archive.b2b_cat_item_dec_pubbackfill_bak_20260618 set schema public;
-- alter table archive.b2b_cat_item_img_pubbackfill_bak_20260618 set schema public;
-- alter table archive.b2b_catalogue_item_colors_crewsocksmerge_bak_20260630 set schema public;
-- alter table archive.b2b_catalogue_item_colors_junk_bak_20260605 set schema public;
-- alter table archive.b2b_catalogue_item_colors_straytest_bak_20260611 set schema public;
-- alter table archive.b2b_catalogue_item_decorations_crewsocksmerge_bak_20260630 set schema public;
-- alter table archive.b2b_catalogue_item_decorations_junk_bak_20260605 set schema public;
-- alter table archive.b2b_catalogue_item_decorations_orgnuke_bak_20260612 set schema public;
-- alter table archive.b2b_catalogue_item_images_crewsocksmerge_bak_20260630 set schema public;
-- alter table archive.b2b_catalogue_item_images_dedupe_bak_20260618 set schema public;
-- alter table archive.b2b_catalogue_item_images_heroflip_bak_20260606 set schema public;
-- alter table archive.b2b_catalogue_item_images_junk_bak_20260605 set schema public;
-- alter table archive.b2b_catalogue_item_images_straytest_bak_20260611 set schema public;
-- alter table archive.b2b_catalogue_item_pricing_tiers_crewsocksmerge_bak_20260630 set schema public;
-- alter table archive.b2b_catalogue_items_crewsocksmerge_bak_20260630 set schema public;
-- alter table archive.b2b_catalogue_items_demorewire_bak_20260611 set schema public;
-- alter table archive.b2b_catalogue_items_nuke_bak_20260612 set schema public;
-- alter table archive.b2b_catalogue_items_orgnuke_bak_20260612 set schema public;
-- alter table archive.b2b_catalogue_items_preorderdesc_bak_20260630 set schema public;
-- alter table archive.b2b_catalogues_orgnuke_bak_20260612 set schema public;
-- alter table archive.b2b_ordering_period_item_pricing_anytimefit_bak_20260626 set schema public;
-- alter table archive.b2b_ordering_period_item_pricing_nuke_bak_20260612 set schema public;
-- alter table archive.b2b_ordering_periods_anytimefit_bak_20260626 set schema public;
-- alter table archive.b2b_ordering_periods_orgnuke_bak_20260612 set schema public;
-- alter table archive.brands_bak_20260629 set schema public;
-- alter table archive.brands_brandmerge_bak_20260629 set schema public;
-- alter table archive.categories_bak_20260629 set schema public;
-- alter table archive.chat_conversations_chatv0_bak_20260713 set schema public;
-- alter table archive.chat_messages_chatv0_bak_20260713 set schema public;
-- alter table archive.chat_users_chatv0_bak_20260713 set schema public;
-- alter table archive.demo_rewire_map_20260611 set schema public;
-- alter table archive.design_artwork_orgnuke_bak_20260612 set schema public;
-- alter table archive.design_proof_versions_orgnuke_bak_20260612 set schema public;
-- alter table archive.design_proofs_orgnuke_bak_20260612 set schema public;
-- alter table archive.designs_orgnuke_bak_20260612 set schema public;
-- alter table archive.embroidery_price_ladder_v1_backup_20251110 set schema public;
-- alter table archive.job_trackers_anytime79_bak_20260701 set schema public;
-- alter table archive.job_trackers_anytimefit_bak_20260626 set schema public;
-- alter table archive.job_trackers_anytimetest_bak_20260701 set schema public;
-- alter table archive.job_trackers_demo_bak_20260701 set schema public;
-- alter table archive.order_email_log_anytime79_bak_20260701 set schema public;
-- alter table archive.order_email_log_anytimefit_bak_20260626 set schema public;
-- alter table archive.order_email_log_anytimetest_bak_20260701 set schema public;
-- alter table archive.order_email_log_orgnuke_bak_20260612 set schema public;
-- alter table archive.order_extras_orgnuke_bak_20260612 set schema public;
-- alter table archive.orders_anytime79_bak_20260701 set schema public;
-- alter table archive.orders_anytimefit_bak_20260626 set schema public;
-- alter table archive.orders_anytimetest_bak_20260701 set schema public;
-- alter table archive.orders_orgnuke_bak_20260612 set schema public;
-- alter table archive.org_decorations_orgnuke_bak_20260612 set schema public;
-- alter table archive.organization_artwork_variants_orgnuke_bak_20260612 set schema public;
-- alter table archive.organization_artworks_orgnuke_bak_20260612 set schema public;
-- alter table archive.organizations_orgnuke_bak_20260612 set schema public;
-- alter table archive.product_color_swatches_ascolour_bak_20260609 set schema public;
-- alter table archive.product_color_swatches_bcdead_bak_20260609 set schema public;
-- alter table archive.product_color_swatches_gymduffel_bak_20260629 set schema public;
-- alter table archive.product_color_swatches_imgcolourlink_bak_20260606 set schema public;
-- alter table archive.product_color_swatches_junk_bak_20260605 set schema public;
-- alter table archive.product_color_swatches_nuke_bak_20260612 set schema public;
-- alter table archive.product_color_swatches_straytest_bak_20260611 set schema public;
-- alter table archive.product_images_ascolour_bak_20260609 set schema public;
-- alter table archive.product_images_ascolour_relink_bak_20260605 set schema public;
-- alter table archive.product_images_bcdead_bak_20260609 set schema public;
-- alter table archive.product_images_dupe_bak_20260605 set schema public;
-- alter table archive.product_images_ecrubackfix_bak_20260619 set schema public;
-- alter table archive.product_images_frontrekey_bak_20260710 set schema public;
-- alter table archive.product_images_gymduffel_bak_20260629 set schema public;
-- alter table archive.product_images_heroflip_bak_20260606 set schema public;
-- alter table archive.product_images_imgcolourlink_bak_20260606 set schema public;
-- alter table archive.product_images_nuke_bak_20260612 set schema public;
-- alter table archive.product_pricing_tiers_backup_tshirt_20260119 set schema public;
-- alter table archive.product_variants_ascolour_bak_20260609 set schema public;
-- alter table archive.product_variants_mtobackfill2_bak_20260629 set schema public;
-- alter table archive.product_variants_mtobackfill_bak_20260629 set schema public;
-- alter table archive.product_variants_nuke_bak_20260612 set schema public;
-- alter table archive.products_ascolour_bak_20260609 set schema public;
-- alter table archive.products_brandfix_bak_20260629 set schema public;
-- alter table archive.products_brandmerge_bak_20260629 set schema public;
-- alter table archive.products_nuke_bak_20260612 set schema public;
-- alter table archive.quote_items_anytime79_bak_20260701 set schema public;
-- alter table archive.quote_items_anytimeq_bak_20260701 set schema public;
-- alter table archive.quote_items_anytimetest_bak_20260701 set schema public;
-- alter table archive.quote_items_crewsocksmerge_bak_20260630 set schema public;
-- alter table archive.quote_items_nuke_bak_20260612 set schema public;
-- alter table archive.quote_items_orgnuke_bak_20260612 set schema public;
-- alter table archive.quotes_anytime79_bak_20260701 set schema public;
-- alter table archive.quotes_anytimeq_bak_20260701 set schema public;
-- alter table archive.quotes_anytimetest_bak_20260701 set schema public;
-- alter table archive.quotes_orgnuke_bak_20260612 set schema public;
-- alter table archive.staging_shopify_companies_orgnuke_bak_20260612 set schema public;
-- alter table archive.staging_shopify_matches_nuke_bak_20260612 set schema public;
-- alter table archive.stores_orgnuke_bak_20260612 set schema public;
-- alter table archive.user_organizations_orgnuke_bak_20260612 set schema public;
-- alter table archive.variant_inventory_anytimeteesize_bak_20260625 set schema public;
-- alter table archive.variant_inventory_events_anytimetest_bak_20260701 set schema public;
-- alter table archive.variant_inventory_events_nuke_bak_20260612 set schema public;
-- alter table archive.variant_inventory_orgnuke_bak_20260612 set schema public;
