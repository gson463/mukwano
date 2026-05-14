-- Centre (center) meetings + borrower attendance — same model as sibling FCL product.
-- One meeting row per (center, date); all groups under that center share the session.

CREATE TABLE IF NOT EXISTS public.center_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.centers (id) ON DELETE CASCADE,
  meeting_date date NOT NULL,
  loan_officer_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT center_meetings_center_date_uniq UNIQUE (center_id, meeting_date)
);

CREATE INDEX IF NOT EXISTS idx_center_meetings_center_id ON public.center_meetings (center_id);
CREATE INDEX IF NOT EXISTS idx_center_meetings_meeting_date ON public.center_meetings (meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_center_meetings_officer ON public.center_meetings (loan_officer_id);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_meeting_id uuid NOT NULL REFERENCES public.center_meetings (id) ON DELETE CASCADE,
  borrower_id uuid NOT NULL REFERENCES public.borrowers (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE RESTRICT,
  attendance_status text NOT NULL DEFAULT 'present',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_meeting_borrower_uniq UNIQUE (center_meeting_id, borrower_id),
  CONSTRAINT attendance_records_status_chk CHECK (
    attendance_status IN ('present', 'absent', 'ruhusa')
  )
);

CREATE INDEX IF NOT EXISTS idx_attendance_borrower ON public.attendance_records (borrower_id);
CREATE INDEX IF NOT EXISTS idx_attendance_meeting ON public.attendance_records (center_meeting_id);

COMMENT ON TABLE public.center_meetings IS 'One row per center per meeting date; groups under the center share this session.';
COMMENT ON TABLE public.attendance_records IS 'Borrower attendance per meeting: present, absent, or ruhusa (excused).';

ALTER TABLE public.center_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "center_meetings_scope" ON public.center_meetings;
CREATE POLICY "center_meetings_scope" ON public.center_meetings
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = center_meetings.center_id
          AND c.branch_id IS NOT DISTINCT FROM (
            SELECT u2.branch_id FROM public.users u2 WHERE u2.id = auth.uid()
          )
      )
    )
    OR (
      center_meetings.loan_officer_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = center_meetings.center_id AND c.loan_officer_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = center_meetings.center_id
          AND c.branch_id IS NOT DISTINCT FROM (
            SELECT u2.branch_id FROM public.users u2 WHERE u2.id = auth.uid()
          )
      )
    )
    OR (
      center_meetings.loan_officer_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = center_meetings.center_id AND c.loan_officer_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "attendance_records_scope" ON public.attendance_records;
CREATE POLICY "attendance_records_scope" ON public.attendance_records
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND EXISTS (
        SELECT 1 FROM public.center_meetings cm
        JOIN public.centers c ON c.id = cm.center_id
        WHERE cm.id = attendance_records.center_meeting_id
          AND c.branch_id IS NOT DISTINCT FROM (
            SELECT u2.branch_id FROM public.users u2 WHERE u2.id = auth.uid()
          )
      )
    )
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'officer')
      AND EXISTS (
        SELECT 1 FROM public.center_meetings cm
        WHERE cm.id = attendance_records.center_meeting_id AND cm.loan_officer_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'manager')
      AND EXISTS (
        SELECT 1 FROM public.center_meetings cm
        JOIN public.centers c ON c.id = cm.center_id
        WHERE cm.id = attendance_records.center_meeting_id
          AND c.branch_id IS NOT DISTINCT FROM (
            SELECT u2.branch_id FROM public.users u2 WHERE u2.id = auth.uid()
          )
      )
    )
    OR (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'officer')
      AND EXISTS (
        SELECT 1 FROM public.center_meetings cm
        WHERE cm.id = attendance_records.center_meeting_id AND cm.loan_officer_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM public.borrowers b
        WHERE b.id = attendance_records.borrower_id AND b.loan_officer_id = auth.uid()
      )
    )
  );

REVOKE ALL ON public.center_meetings FROM PUBLIC;
REVOKE ALL ON public.attendance_records FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.center_meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;

INSERT INTO public.system_config (key, value)
SELECT 'attendanceMinMeetingsForIncreaseEligibility', '6'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_config WHERE key = 'attendanceMinMeetingsForIncreaseEligibility'
);

INSERT INTO public.system_config (key, value)
SELECT 'attendanceRequireNoDefaultForAutoIncrease', 'true'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_config WHERE key = 'attendanceRequireNoDefaultForAutoIncrease'
);
