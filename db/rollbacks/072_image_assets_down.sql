-- Rollback 072. Drops the image asset library table.
-- Files under data/image-assets/ on the server are NOT removed by this
-- script; delete or archive that folder by hand after taking a backup.
BEGIN;

DROP TABLE IF EXISTS image_assets;

DELETE FROM schema_migrations WHERE name = '072_image_assets.sql';

COMMIT;
