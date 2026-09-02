-- Enable RLS on public tables exposed via PostgREST.
-- Tables borrowers, branches, holidays, loan_products, loans, repayments,
-- system_config, and users already have RLS policies in Supabase; enabling RLS
-- activates those policies without recreating them.
-- centers, groups, and expenses get new scope policies aligned with center_meetings.

ALTER TABLE public.borrowers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Officers (and any user) need SELECT on their own branch for embedded joins, e.g. borrowers → branches.
DROP POLICY IF EXISTS "Allow users to read own branch" ON public.branches;
CREATE POLICY "Allow users to read own branch" ON public.branches
  FOR SELECT TO authenticated
  USING (
    id IS NOT DISTINCT FROM (
      SELECT u.branch_id FROM public.users u WHERE u.id = auth.uid()
    )
  );

-- centers: admin all; manager branch; officer own centres
DROP POLICY IF EXISTS "centers_scope" ON public.centers;
CREATE POLICY "centers_scope" ON public.centers
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND centers.branch_id IS NOT DISTINCT FROM (
        SELECT u2.branch_id FROM public.users u2 WHERE u2.id = auth.uid()
      )
    )
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'officer')
      AND centers.loan_officer_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND centers.branch_id IS NOT DISTINCT FROM (
        SELECT u2.branch_id FROM public.users u2 WHERE u2.id = auth.uid()
      )
    )
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'officer')
      AND centers.loan_officer_id = auth.uid()
    )
  );

-- groups: admin all; manager branch (via centre); officer own groups
DROP POLICY IF EXISTS "groups_scope" ON public.groups;
CREATE POLICY "groups_scope" ON public.groups
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = groups.center_id
          AND c.branch_id IS NOT DISTINCT FROM (
            SELECT u2.branch_id FROM public.users u2 WHERE u2.id = auth.uid()
          )
      )
    )
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'officer')
      AND groups.loan_officer_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = groups.center_id
          AND c.branch_id IS NOT DISTINCT FROM (
            SELECT u2.branch_id FROM public.users u2 WHERE u2.id = auth.uid()
          )
      )
    )
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'officer')
      AND groups.loan_officer_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = groups.center_id AND c.loan_officer_id = auth.uid()
      )
    )
  );

-- expenses: admin all; officer own; manager branch officers
DROP POLICY IF EXISTS "expenses_scope" ON public.expenses;
CREATE POLICY "expenses_scope" ON public.expenses
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'officer')
      AND expenses.officer_id = auth.uid()
    )
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND EXISTS (
        SELECT 1 FROM public.users u2
        WHERE u2.id = expenses.officer_id
          AND u2.branch_id IS NOT DISTINCT FROM (
            SELECT u3.branch_id FROM public.users u3 WHERE u3.id = auth.uid()
          )
      )
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'officer')
      AND expenses.officer_id = auth.uid()
    )
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND EXISTS (
        SELECT 1 FROM public.users u2
        WHERE u2.id = expenses.officer_id
          AND u2.branch_id IS NOT DISTINCT FROM (
            SELECT u3.branch_id FROM public.users u3 WHERE u3.id = auth.uid()
          )
      )
    )
  );

REVOKE ALL ON public.centers FROM PUBLIC;
REVOKE ALL ON public.groups FROM PUBLIC;
REVOKE ALL ON public.expenses FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.centers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
