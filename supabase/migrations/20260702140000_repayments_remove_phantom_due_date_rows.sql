-- Remove phantom repayment rows created when legacy code stamped actual_payment_date
-- with installment due dates (multiple rows per loan in one insert batch).
-- Keep the row that best matches the real collection day: prefer (created_at EAT date - 1 day)
-- for next-morning recording, else created_at EAT, else earliest date in the batch.

DO $$
DECLARE
  rec RECORD;
  v_keep uuid;
  v_eat date;
  v_target date;
  v_loan uuid;
  affected uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR rec IN
    SELECT r.loan_id, date_trunc('second', r.created_at) AS ts
    FROM public.repayments r
    GROUP BY r.loan_id, date_trunc('second', r.created_at)
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT r.actual_payment_date) > 1
  LOOP
    v_loan := rec.loan_id;
    v_eat := (
      SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date
      FROM public.repayments
      WHERE loan_id = rec.loan_id AND date_trunc('second', created_at) = rec.ts
      LIMIT 1
    );
    v_target := v_eat - 1;

    SELECT r.id INTO v_keep
    FROM public.repayments r
    WHERE r.loan_id = rec.loan_id
      AND date_trunc('second', r.created_at) = rec.ts
      AND r.actual_payment_date = v_target
    LIMIT 1;

    IF v_keep IS NULL THEN
      SELECT r.id INTO v_keep
      FROM public.repayments r
      WHERE r.loan_id = rec.loan_id
        AND date_trunc('second', r.created_at) = rec.ts
        AND r.actual_payment_date = v_eat
      LIMIT 1;
    END IF;

    IF v_keep IS NULL THEN
      SELECT r.id INTO v_keep
      FROM public.repayments r
      WHERE r.loan_id = rec.loan_id
        AND date_trunc('second', r.created_at) = rec.ts
      ORDER BY r.actual_payment_date ASC, r.id ASC
      LIMIT 1;
    END IF;

    DELETE FROM public.repayments r
    WHERE r.loan_id = rec.loan_id
      AND date_trunc('second', r.created_at) = rec.ts
      AND r.id <> v_keep;

    IF NOT v_loan = ANY(affected) THEN
      affected := array_append(affected, v_loan);
    END IF;
  END LOOP;

  FOREACH v_loan IN ARRAY affected
  LOOP
    PERFORM public.recalculate_loan_schedule(v_loan);
  END LOOP;
END $$;
