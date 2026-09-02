-- Lint 0029: current_user_role / current_user_branch_id are RLS helpers only (not app RPCs).
-- Move to private schema (not exposed via PostgREST); policies call private.* directly.

DO $migrate$
BEGIN
  IF to_regprocedure('private.current_user_role()') IS NOT NULL
     AND to_regprocedure('public.current_user_role()') IS NOT NULL THEN
    DROP FUNCTION public.current_user_role();
  ELSIF to_regprocedure('public.current_user_role()') IS NOT NULL THEN
    ALTER FUNCTION public.current_user_role() SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.current_user_branch_id()') IS NOT NULL
     AND to_regprocedure('public.current_user_branch_id()') IS NOT NULL THEN
    DROP FUNCTION public.current_user_branch_id();
  ELSIF to_regprocedure('public.current_user_branch_id()') IS NOT NULL THEN
    ALTER FUNCTION public.current_user_branch_id() SET SCHEMA private;
  END IF;
END
$migrate$;

REVOKE ALL ON FUNCTION private.current_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_user_branch_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_user_branch_id() TO authenticated;

DROP POLICY IF EXISTS "Allow admin full access" ON public.users;
CREATE POLICY "Allow admin full access" ON public.users
  FOR ALL TO authenticated
  USING (private.current_user_role() = 'admin')
  WITH CHECK (private.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Allow manager to manage branch users" ON public.users;
CREATE POLICY "Allow manager to manage branch users" ON public.users
  FOR ALL TO authenticated
  USING (
    private.current_user_role() = 'manager'
    AND branch_id IS NOT DISTINCT FROM private.current_user_branch_id()
  )
  WITH CHECK (
    private.current_user_role() = 'manager'
    AND branch_id IS NOT DISTINCT FROM private.current_user_branch_id()
  );

DROP POLICY IF EXISTS "Allow manager to see branch users" ON public.users;
CREATE POLICY "Allow manager to see branch users" ON public.users
  FOR SELECT TO authenticated
  USING (branch_id IS NOT DISTINCT FROM private.current_user_branch_id());

NOTIFY pgrst, 'reload schema';
