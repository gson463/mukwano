-- Mukwano: all migrations in this repo, in order (for SQL Editor or psql).
-- Project: jdwgpfyaygirkqyywvvj — run in Supabase Dashboard → SQL → New query → Run.
-- Section 1: functions + RPC only (no full-table unique indexes — avoids 23505 on historical duplicates).
-- Section 3: duplicate_of_borrower_id + partial unique indexes. If an old run left idx_borrowers_*_norm_unique
-- (full) in place, run supabase/DROP_LEGACY_FULL_UNIQUE_INDEXES.sql before re-running section 3.

-- 1/3 20260424120000_borrower_identity_uniqueness.sql
CREATE OR REPLACE FUNCTION public.normalize_borrower_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
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
AS $$
  SELECT nullif(lower(trim(coalesce(p, ''))), '');
$$;

COMMENT ON FUNCTION public.normalize_borrower_phone IS 'Whitespace-insensitive phone key for duplicate checks.';
COMMENT ON FUNCTION public.normalize_borrower_id_number IS 'Lowercase trimmed ID key for duplicate checks.';

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
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.borrower_id, b.first_name, b.surname, b.loan_officer_id, b.branch_id
  FROM public.borrowers b
  WHERE (p_exclude_borrower_id IS NULL OR b.id <> p_exclude_borrower_id)
    AND (
      (public.normalize_borrower_phone(p_phone) IS NOT NULL
        AND public.normalize_borrower_phone(p_phone) = public.normalize_borrower_phone(b.phone_number))
      OR
      (public.normalize_borrower_id_number(p_identification_number) IS NOT NULL
        AND public.normalize_borrower_id_number(p_identification_number) = public.normalize_borrower_id_number(b.identification_number))
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_borrower_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_borrower_id_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_duplicate_borrower(text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.find_duplicate_borrower IS 'Returns an existing borrower if phone or ID matches another record (any officer).';

-- 2/3 20260424130000_borrower_center_id.sql
ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS center_id uuid REFERENCES public.centers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_borrowers_center_id ON public.borrowers (center_id) WHERE center_id IS NOT NULL;

-- 3/3 20260426160000_borrower_duplicate_of_and_partial_uniques.sql
-- Mark duplicate_of_borrower_id, replace full unique indexes with partial (canonical rows only).

CREATE OR REPLACE FUNCTION public.normalize_borrower_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
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
AS $$
  SELECT nullif(lower(trim(coalesce(p, ''))), '');
$$;

ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS duplicate_of_borrower_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'borrowers_duplicate_of_borrower_id_fkey'
  ) THEN
    ALTER TABLE public.borrowers
      ADD CONSTRAINT borrowers_duplicate_of_borrower_id_fkey
      FOREIGN KEY (duplicate_of_borrower_id) REFERENCES public.borrowers (id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.borrowers DROP CONSTRAINT IF EXISTS borrowers_duplicate_of_not_self;
ALTER TABLE public.borrowers
  ADD CONSTRAINT borrowers_duplicate_of_not_self
  CHECK (duplicate_of_borrower_id IS NULL OR duplicate_of_borrower_id <> id);

WITH idd AS (
  SELECT
    b.id,
    (min(b.id::text) OVER (
      PARTITION BY public.normalize_borrower_id_number(b.identification_number)
    ))::uuid AS keeper
  FROM public.borrowers b
  WHERE public.normalize_borrower_id_number(b.identification_number) IS NOT NULL
)
UPDATE public.borrowers b
SET duplicate_of_borrower_id = idd.keeper
FROM idd
WHERE b.id = idd.id
  AND idd.id <> idd.keeper;

WITH ph AS (
  SELECT
    b.id,
    (min(b.id::text) OVER (
      PARTITION BY public.normalize_borrower_phone(b.phone_number)
    ))::uuid AS keeper
  FROM public.borrowers b
  WHERE public.normalize_borrower_phone(b.phone_number) IS NOT NULL
    AND b.duplicate_of_borrower_id IS NULL
)
UPDATE public.borrowers b
SET duplicate_of_borrower_id = ph.keeper
FROM ph
WHERE b.id = ph.id
  AND ph.id <> ph.keeper;

DROP INDEX IF EXISTS public.idx_borrowers_phone_norm_unique;
DROP INDEX IF EXISTS public.idx_borrowers_ident_norm_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_borrowers_phone_norm_unique_canonical
  ON public.borrowers (public.normalize_borrower_phone(phone_number))
  WHERE phone_number IS NOT NULL
    AND trim(phone_number) <> ''
    AND duplicate_of_borrower_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_borrowers_ident_norm_unique_canonical
  ON public.borrowers (public.normalize_borrower_id_number(identification_number))
  WHERE identification_number IS NOT NULL
    AND trim(identification_number) <> ''
    AND duplicate_of_borrower_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_borrowers_duplicate_of
  ON public.borrowers (duplicate_of_borrower_id)
  WHERE duplicate_of_borrower_id IS NOT NULL;

COMMENT ON COLUMN public.borrowers.duplicate_of_borrower_id IS 'If set, this row is a duplicate record; canonical borrower is duplicate_of_borrower_id.';

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
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.borrower_id, b.first_name, b.surname, b.loan_officer_id, b.branch_id
  FROM public.borrowers b
  WHERE (p_exclude_borrower_id IS NULL OR b.id <> p_exclude_borrower_id)
    AND (
      (public.normalize_borrower_phone(p_phone) IS NOT NULL
        AND public.normalize_borrower_phone(p_phone) = public.normalize_borrower_phone(b.phone_number))
      OR
      (public.normalize_borrower_id_number(p_identification_number) IS NOT NULL
        AND public.normalize_borrower_id_number(p_identification_number) = public.normalize_borrower_id_number(b.identification_number))
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_duplicate_borrower(text, text, uuid) TO authenticated;

-- 4/4 20260427120000_borrower_name_similarity.sql (pg_trgm — enable in Dashboard if needed)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
SET search_path = public
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
    (similarity(
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
    AND similarity(
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

GRANT EXECUTE ON FUNCTION public.find_similar_borrower_name(text, text, uuid, real) TO authenticated;

-- 5/5 20260428120000_audit_logs.sql
-- (Full SQL duplicated from supabase/migrations/20260428120000_audit_logs.sql; run that file alone or this block in SQL editor.)

-- Append-only audit trail + admin RPC (aligned with FCL: audit_logs, log_audit_event, get_audit_logs_admin).

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  device_summary text,
  location_label text
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin'
    )
  );

REVOKE ALL ON public.audit_logs FROM PUBLIC;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT INSERT ON TABLE public.audit_logs TO service_role;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_device_summary text DEFAULT NULL,
  p_location_label text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  INSERT INTO public.audit_logs (
    user_id, action, entity_type, entity_id, metadata,
    ip_address, user_agent, device_summary, location_label
  ) VALUES (
    v_uid,
    p_action,
    NULLIF(trim(p_entity_type), ''),
    NULLIF(trim(p_entity_id), ''),
    COALESCE(p_metadata, '{}'::jsonb),
    NULLIF(trim(p_ip_address), ''),
    NULLIF(trim(p_user_agent), ''),
    NULLIF(trim(p_device_summary), ''),
    NULLIF(trim(p_location_label), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_audit_event(
  text, text, text, jsonb, text, text, text, text
) TO authenticated;

DROP FUNCTION IF EXISTS public.get_audit_logs_admin(
  int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS public.get_audit_logs_admin(
  int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid
);

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
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  WITH filtered AS (
    SELECT a.*
    FROM public.audit_logs a
    WHERE (p_from IS NULL OR a.created_at >= p_from)
      AND (p_to IS NULL OR a.created_at <= p_to)
      AND (p_user_id IS NULL OR a.user_id = p_user_id)
      AND (
        p_branch_id IS NULL
        OR a.user_id IS NULL
        OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.user_id AND u.branch_id = p_branch_id)
      )
      AND (
        p_user_role IS NULL OR trim(p_user_role) = ''
        OR a.user_id IS NULL
        OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.user_id AND u.role = p_user_role)
      )
      AND (p_action IS NULL OR trim(p_action) = '' OR a.action ILIKE '%' || trim(p_action) || '%')
      AND (p_entity_type IS NULL OR trim(p_entity_type) = '' OR COALESCE(a.entity_type, '') ILIKE '%' || trim(p_entity_type) || '%')
      AND (p_entity_id IS NULL OR trim(p_entity_id) = '' OR COALESCE(a.entity_id, '') ILIKE '%' || trim(p_entity_id) || '%')
      AND (p_ip IS NULL OR trim(p_ip) = '' OR COALESCE(a.ip_address, '') ILIKE '%' || trim(p_ip) || '%')
      AND (p_location IS NULL OR trim(p_location) = '' OR COALESCE(a.location_label, '') ILIKE '%' || trim(p_location) || '%')
      AND (
        p_device IS NULL OR trim(p_device) = ''
        OR COALESCE(a.device_summary, '') ILIKE '%' || trim(p_device) || '%'
        OR COALESCE(a.user_agent, '') ILIKE '%' || trim(p_device) || '%'
      )
      AND (p_metadata IS NULL OR trim(p_metadata) = '' OR a.metadata::text ILIKE '%' || trim(p_metadata) || '%')
      AND (
        p_center_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.centers c
          WHERE c.id = p_center_id
            AND (
              c.loan_officer_id = a.user_id
              OR EXISTS (
                SELECT 1 FROM public.borrowers b
                WHERE b.center_id = p_center_id AND b.loan_officer_id = a.user_id
              )
            )
        )
      )
      AND (
        p_group_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.groups g
          WHERE g.id = p_group_id
            AND (
              g.loan_officer_id = a.user_id
              OR EXISTS (
                SELECT 1 FROM public.borrowers b
                WHERE b.group_id = p_group_id AND b.loan_officer_id = a.user_id
              )
            )
        )
      )
  ),
  counted AS (SELECT COUNT(*)::bigint AS c FROM filtered),
  paged AS (
    SELECT * FROM filtered
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    (SELECT c FROM counted),
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FROM paged p),
      '[]'::jsonb
    )
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_audit_logs_admin(
  int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid
) TO authenticated;

COMMENT ON TABLE public.audit_logs IS 'Security audit log; inserts via log_audit_event RPC or service role (Edge).';
COMMENT ON FUNCTION public.get_audit_logs_admin IS 'Paginated audit_logs for admins only; optional filters including center and group (via officer linkage).';

NOTIFY pgrst, 'reload schema';

-- 6/6 20260429120000_repayments_actual_payment_date_index.sql
CREATE INDEX IF NOT EXISTS idx_repayments_actual_payment_date
  ON public.repayments (actual_payment_date DESC);

-- After a successful run, you can record versions (if your project uses this table):
-- INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20260424120000'), ('20260424130000'), ('20260426160000'), ('20260427120000'), ('20260428120000'), ('20260429120000') ON CONFLICT (version) DO NOTHING;
