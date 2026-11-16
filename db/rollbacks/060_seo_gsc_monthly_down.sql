-- Remove the monthly Search Console roll-up tables added by 060.
-- WARNING: if `seo:gsc-retention --apply` already ran, the rolled-up months
-- exist only here. Restore the daily rows from the csv.gz backup first
-- (docs/seo-os/setup.md, "Search Console data retention"), then run this.
BEGIN;

DROP TABLE IF EXISTS seo_gsc_rollup_months;
DROP TABLE IF EXISTS seo_gsc_page_monthly;
DROP TABLE IF EXISTS seo_gsc_monthly;

DELETE FROM schema_migrations WHERE name = '060_seo_gsc_monthly.sql';

COMMIT;
