-- Remove Website Audit tables added by 055.
BEGIN;

DROP TABLE IF EXISTS seo_audits;
DROP TABLE IF EXISTS seo_audit_settings;

DELETE FROM schema_migrations WHERE name = '055_seo_website_audit.sql';

COMMIT;
