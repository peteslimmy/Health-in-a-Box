-- Least-privilege database access. Run once after the first migration, and again after any migration
-- that adds tables (the default privileges below also cover new tables).
--
--   psql -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" -U hnb_owner -d hnb -f ops/db-roles.sql
--
-- hnb_owner owns the schema and runs migrations; it is used only by the migration job and by people
-- doing approved maintenance. hnb_app is what the API connects as. It cannot change the schema, drop
-- or disable triggers, truncate anything, or delete or alter ledger and audit rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hnb_app') THEN
    CREATE ROLE hnb_app LOGIN;
  END IF;
END
$$;
ALTER ROLE hnb_app WITH LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hnb_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hnb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hnb_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hnb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hnb_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hnb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hnb_app;

-- Posted money and the audit trail are append-only. The triggers already refuse UPDATE and DELETE;
-- removing the privileges as well means a bug or a stolen application credential cannot even try.
REVOKE UPDATE, DELETE, TRUNCATE ON "LedgerEntry" FROM hnb_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM hnb_app;
-- Migration history is not the application's business.
REVOKE ALL ON "_prisma_migrations" FROM hnb_app;

-- Check: the application role must not be able to alter the ledger.
DO $$
BEGIN
  IF has_table_privilege('hnb_app', '"LedgerEntry"', 'UPDATE')
     OR has_table_privilege('hnb_app', '"LedgerEntry"', 'DELETE')
     OR has_table_privilege('hnb_app', '"AuditEvent"', 'DELETE')
     OR has_table_privilege('hnb_app', '"LedgerEntry"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'hnb_app can still alter the ledger or audit trail';
  END IF;
END
$$;
