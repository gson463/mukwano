-- Fix: infinite recursion in users RLS (policies queried users while evaluating users).
-- SECURITY DEFINER helpers read the caller row without re-entering users policies.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.current_user_branch_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.users WHERE id = auth.uid();
$$;

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

-- "Allow users to see themselves" unchanged (id = auth.uid(), no recursion)

NOTIFY pgrst, 'reload schema';
