-- Least-privilege database roles for ChamaHub. Run ONCE per database as the database owner
-- (the account migrations already use), e.g.:
--
--   psql "$OWNER_DATABASE_URL" -v app_password="'<from your secret manager>'" -f backend/scripts/db-roles.sql
--
-- Result:
--   chamahub_app  - what the API uses for requests (DATABASE_URL). Reads and writes rows only:
--                   no CREATE/ALTER/DROP, no TRUNCATE, cannot own or change tables, not a superuser.
--   owner account - unchanged; used only by `prisma migrate deploy` (keep its URL out of the API).
--
-- The password is passed in by you, never stored in this file. Re-running is safe.
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chamahub_app') THEN
    CREATE ROLE chamahub_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE chamahub_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :app_password;
ALTER ROLE chamahub_app SET statement_timeout = '30s';
ALTER ROLE chamahub_app SET idle_in_transaction_session_timeout = '60s';

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM chamahub_app;
GRANT USAGE ON SCHEMA public TO chamahub_app;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM chamahub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO chamahub_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chamahub_app;
-- Migration history is read at start-up (to refuse running on a stale schema) but never written.
REVOKE INSERT, UPDATE, DELETE ON TABLE public."_prisma_migrations" FROM chamahub_app;

-- Every table has row level security on with no policies (migration 20261026000000_lock_down_data_api),
-- so only the owner sees rows. Give chamahub_app its own policy on each table; Supabase's anon and
-- authenticated roles still see nothing. Tables added by later migrations are invisible to the
-- app until this file is run again, so RUN IT AFTER EVERY `prisma migrate deploy` (it fails closed).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS chamahub_app_rows ON public.%I', t.tablename);
    IF t.tablename = '_prisma_migrations' THEN
      EXECUTE format('CREATE POLICY chamahub_app_rows ON public.%I FOR SELECT TO chamahub_app USING (true)', t.tablename);
    ELSE
      EXECUTE format('CREATE POLICY chamahub_app_rows ON public.%I FOR ALL TO chamahub_app USING (true) WITH CHECK (true)', t.tablename);
    END IF;
  END LOOP;
END $$;

-- Tables created by future migrations (run as the owner) get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chamahub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO chamahub_app;
