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

-- Remove every overload: older 14-arg filter RPC and current 16-arg; PostgREST must resolve one signature only.
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

-- Refresh PostgREST so `supabase.rpc('get_audit_logs_admin', ...)` is visible (schema cache).
NOTIFY pgrst, 'reload schema';
