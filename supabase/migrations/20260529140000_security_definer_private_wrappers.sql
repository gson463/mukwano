-- Lint 0029: public SECURITY DEFINER RPCs callable by authenticated.
-- Move implementations to private schema (not exposed via PostgREST); public API stays SECURITY INVOKER.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, authenticated, service_role;

-- Idempotent: remote may already have private implementations (partial apply / SQL editor).
DO $migrate$
BEGIN
  IF to_regprocedure('private.find_duplicate_borrower(text,text,uuid)') IS NOT NULL
     AND to_regprocedure('public.find_duplicate_borrower(text,text,uuid)') IS NOT NULL THEN
    DROP FUNCTION public.find_duplicate_borrower(text, text, uuid);
  ELSIF to_regprocedure('public.find_duplicate_borrower(text,text,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.find_duplicate_borrower(text, text, uuid) SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.find_similar_borrower_name(text,text,uuid,real)') IS NOT NULL
     AND to_regprocedure('public.find_similar_borrower_name(text,text,uuid,real)') IS NOT NULL THEN
    DROP FUNCTION public.find_similar_borrower_name(text, text, uuid, real);
  ELSIF to_regprocedure('public.find_similar_borrower_name(text,text,uuid,real)') IS NOT NULL THEN
    ALTER FUNCTION public.find_similar_borrower_name(text, text, uuid, real) SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.get_audit_logs_admin(int,int,timestamptz,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid)') IS NOT NULL
     AND to_regprocedure('public.get_audit_logs_admin(int,int,timestamptz,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid)') IS NOT NULL THEN
    DROP FUNCTION public.get_audit_logs_admin(
      int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid
    );
  ELSIF to_regprocedure('public.get_audit_logs_admin(int,int,timestamptz,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.get_audit_logs_admin(
      int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid
    ) SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.get_branch_stats(uuid,date,date)') IS NOT NULL
     AND to_regprocedure('public.get_branch_stats(uuid,date,date)') IS NOT NULL THEN
    DROP FUNCTION public.get_branch_stats(uuid, date, date);
  ELSIF to_regprocedure('public.get_branch_stats(uuid,date,date)') IS NOT NULL THEN
    ALTER FUNCTION public.get_branch_stats(uuid, date, date) SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.get_officer_stats(uuid,date,date)') IS NOT NULL
     AND to_regprocedure('public.get_officer_stats(uuid,date,date)') IS NOT NULL THEN
    DROP FUNCTION public.get_officer_stats(uuid, date, date);
  ELSIF to_regprocedure('public.get_officer_stats(uuid,date,date)') IS NOT NULL THEN
    ALTER FUNCTION public.get_officer_stats(uuid, date, date) SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.get_system_wide_stats(date,date)') IS NOT NULL
     AND to_regprocedure('public.get_system_wide_stats(date,date)') IS NOT NULL THEN
    DROP FUNCTION public.get_system_wide_stats(date, date);
  ELSIF to_regprocedure('public.get_system_wide_stats(date,date)') IS NOT NULL THEN
    ALTER FUNCTION public.get_system_wide_stats(date, date) SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.log_audit_event(text,text,text,jsonb,text,text,text,text)') IS NOT NULL
     AND to_regprocedure('public.log_audit_event(text,text,text,jsonb,text,text,text,text)') IS NOT NULL THEN
    DROP FUNCTION public.log_audit_event(text, text, text, jsonb, text, text, text, text);
  ELSIF to_regprocedure('public.log_audit_event(text,text,text,jsonb,text,text,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.log_audit_event(text, text, text, jsonb, text, text, text, text) SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.reassign_partial_officer_data(uuid,uuid,uuid[],uuid[],boolean)') IS NOT NULL
     AND to_regprocedure('public.reassign_partial_officer_data(uuid,uuid,uuid[],uuid[],boolean)') IS NOT NULL THEN
    DROP FUNCTION public.reassign_partial_officer_data(uuid, uuid, uuid[], uuid[], boolean);
  ELSIF to_regprocedure('public.reassign_partial_officer_data(uuid,uuid,uuid[],uuid[],boolean)') IS NOT NULL THEN
    ALTER FUNCTION public.reassign_partial_officer_data(uuid, uuid, uuid[], uuid[], boolean) SET SCHEMA private;
  END IF;

  IF to_regprocedure('private.update_loan_status(uuid,text)') IS NOT NULL
     AND to_regprocedure('public.update_loan_status(uuid,text)') IS NOT NULL THEN
    DROP FUNCTION public.update_loan_status(uuid, text);
  ELSIF to_regprocedure('public.update_loan_status(uuid,text)') IS NOT NULL THEN
    ALTER FUNCTION public.update_loan_status(uuid, text) SET SCHEMA private;
  END IF;
END
$migrate$;

CREATE OR REPLACE FUNCTION public.find_duplicate_borrower(
  p_phone text,
  p_identification_number text,
  p_exclude_borrower_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  borrower_id text,
  first_name text,
  surname text,
  loan_officer_id uuid,
  branch_id uuid
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM private.find_duplicate_borrower($1, $2, $3);
$$;

CREATE OR REPLACE FUNCTION public.find_similar_borrower_name(
  p_first_name text,
  p_surname text,
  p_exclude_borrower_id uuid DEFAULT NULL,
  p_min_similarity real DEFAULT 0.40
)
RETURNS TABLE (
  id uuid,
  borrower_id text,
  first_name text,
  surname text,
  loan_officer_id uuid,
  branch_id uuid,
  name_similarity real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM private.find_similar_borrower_name($1, $2, $3, $4);
$$;

CREATE OR REPLACE FUNCTION public.get_audit_logs_admin(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_user_role text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_metadata text DEFAULT NULL,
  p_center_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.get_audit_logs_admin(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
  );
$$;

CREATE OR REPLACE FUNCTION public.get_branch_stats(
  p_branch_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE (
  total_loan_officers bigint,
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  principal_repayments_collected numeric,
  total_interest_collected numeric,
  total_outstanding_principal numeric,
  total_defaulted_principal numeric,
  total_outstanding_interest numeric,
  total_defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM private.get_branch_stats($1, $2, $3);
$$;

CREATE OR REPLACE FUNCTION public.get_officer_stats(
  p_officer_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE (
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  total_interest_collected numeric,
  principal_repayments_collected numeric,
  outstanding_principal numeric,
  outstanding_interest numeric,
  defaulted_principal numeric,
  defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM private.get_officer_stats($1, $2, $3);
$$;

CREATE OR REPLACE FUNCTION public.get_system_wide_stats(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE (
  total_branches bigint,
  total_users bigint,
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  principal_repayments_collected numeric,
  total_interest_collected numeric,
  total_outstanding_principal numeric,
  total_defaulted_principal numeric,
  total_outstanding_interest numeric,
  total_defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM private.get_system_wide_stats($1, $2);
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_device_summary text DEFAULT NULL,
  p_location_label text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.log_audit_event(
    $1, $2, $3, $4, $5, $6, $7, $8
  );
$$;

CREATE OR REPLACE FUNCTION public.reassign_partial_officer_data(
  p_old_officer_id uuid,
  p_new_officer_id uuid,
  p_center_ids uuid[],
  p_group_ids uuid[],
  p_reassign_all boolean
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.reassign_partial_officer_data($1, $2, $3, $4, $5);
$$;

CREATE OR REPLACE FUNCTION public.update_loan_status(
  p_loan_id uuid,
  p_new_status text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT private.update_loan_status($1, $2);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;

GRANT EXECUTE ON FUNCTION public.find_duplicate_borrower(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_similar_borrower_name(text, text, uuid, real) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_logs_admin(
  int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_officer_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_wide_stats(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(
  text, text, text, jsonb, text, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_partial_officer_data(uuid, uuid, uuid[], uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_loan_status(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
