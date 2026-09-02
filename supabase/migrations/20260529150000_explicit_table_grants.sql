-- Supabase Data API grant model (required for new tables after Oct 30, 2026 on existing projects).
-- PostgREST only exposes tables the role may access; RLS then filters rows.
-- Pattern: REVOKE broad access → GRANT authenticated → enable RLS → create policies.

-- 1) Backfill explicit grants on all current public app tables
REVOKE ALL ON TABLE public.attendance_records FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.borrowers FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.branches FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.center_meetings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.centers FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.expenses FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.groups FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.holidays FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.loan_products FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.loans FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.repayments FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.system_config FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.borrowers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.center_meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.centers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.holidays TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.loan_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.loans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.repayments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO authenticated;

-- Audit log: read via RLS; inserts via log_audit_event (private) / service_role
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- 2) Default privileges for tables created by future migrations (postgres role)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

-- 3) Template for every new public table migration:
--    CREATE TABLE public.foo (...);
--    REVOKE ALL ON TABLE public.foo FROM PUBLIC, anon;
--    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.foo TO authenticated;
--    ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
--    CREATE POLICY ...;

NOTIFY pgrst, 'reload schema';
