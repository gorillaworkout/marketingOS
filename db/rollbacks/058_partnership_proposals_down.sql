-- Remove the B2B Proposal Builder tables added by 058. Deletes saved proposals,
-- their version history, and admin proposal settings. Take a backup first.
BEGIN;

DROP TABLE IF EXISTS partnership_proposal_versions;
DROP TABLE IF EXISTS partnership_proposals;
DROP TABLE IF EXISTS partnership_settings;

DELETE FROM schema_migrations WHERE name = '058_partnership_proposals.sql';

COMMIT;
