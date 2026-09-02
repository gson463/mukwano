-- Supabase database linter fixes (WARN level):
-- 0011 function_search_path_mutable, 0014 extension_in_public,
-- 0025 public_bucket_allows_listing, 0028 anon_security_definer_function_executable

-- 1) Immutable normalize helpers: pin search_path
CREATE OR REPLACE FUNCTION public.normalize_borrower_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT nullif(
    regexp_replace(lower(trim(coalesce(p, ''))), '\s', '', 'g'),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_borrower_id_number(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT nullif(lower(trim(coalesce(p, ''))), '');
$$;

REVOKE ALL ON FUNCTION public.normalize_borrower_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_borrower_id_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_borrower_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_borrower_id_number(text) TO authenticated;

-- 2) Move pg_trgm out of public schema
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

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
PARALLEL SAFE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT nullif(
      lower(trim(both regexp_replace(p_first_name, '\s+', ' ', 'g')) || ' ' ||
        trim(both regexp_replace(p_surname, '\s+', ' ', 'g'))),
      ''
    ) AS fullq
  )
  SELECT
    b.id,
    b.borrower_id,
    b.first_name,
    b.surname,
    b.loan_officer_id,
    b.branch_id,
    (extensions.similarity(
      (SELECT fullq FROM q),
      nullif(
        lower(trim(both regexp_replace(b.first_name, '\s+', ' ', 'g')) || ' ' ||
          trim(both regexp_replace(b.surname, '\s+', ' ', 'g'))),
        ''
      )
    ))::real AS name_similarity
  FROM public.borrowers b, q
  WHERE (SELECT fullq FROM q) IS NOT NULL
    AND char_length((SELECT fullq FROM q)) >= 8
    AND (p_exclude_borrower_id IS NULL OR b.id <> p_exclude_borrower_id)
    AND b.duplicate_of_borrower_id IS NULL
    AND nullif(
      lower(trim(both regexp_replace(b.first_name, '\s+', ' ', 'g')) || ' ' ||
        trim(both regexp_replace(b.surname, '\s+', ' ', 'g'))),
      ''
    ) IS NOT NULL
    AND extensions.similarity(
      (SELECT fullq FROM q),
      nullif(
        lower(trim(both regexp_replace(b.first_name, '\s+', ' ', 'g')) || ' ' ||
          trim(both regexp_replace(b.surname, '\s+', ' ', 'g'))),
        ''
      )
    ) >= p_min_similarity
  ORDER BY name_similarity DESC
  LIMIT 1;
$$;

-- 3) Logos bucket: drop broad SELECT (public URLs still work; prevents listing all files)
DROP POLICY IF EXISTS "Public read access for logos" ON storage.objects;

-- 4) SECURITY DEFINER RPCs: revoke anonymous/public execute; re-grant only what the app uses
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS func
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.func);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.func);
  END LOOP;
END $$;

-- App RPCs (authenticated users, signed-in)
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

-- Not exposed to client RPC (trigger / legacy / service-only)
REVOKE ALL ON FUNCTION public.approve_loan_deletion(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.count_users_by_email(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_user_profile() FROM authenticated;
REVOKE ALL ON FUNCTION public.reassign_officer_data(uuid, uuid) FROM authenticated;

-- Non-definer RPCs: still revoke anon execute (defense in depth)
REVOKE ALL ON FUNCTION public.update_all_loan_statuses() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recalculate_loan_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_all_loan_statuses() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_loan_schedule(uuid) TO authenticated;
