-- Prepayment recording: scheduled_due RPCs, atomic record RPC, Mukwano schedule allocation
-- (prepayment forward on future dues from payment date, then backward overflow).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'repayments_prepayment_non_negative'
  ) THEN
    ALTER TABLE public.repayments ADD CONSTRAINT repayments_prepayment_non_negative CHECK (prepayment_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'repayments_prepayment_lte_amount'
  ) THEN
    ALTER TABLE public.repayments ADD CONSTRAINT repayments_prepayment_lte_amount CHECK (prepayment_amount <= amount);
  END IF;
END $$;

INSERT INTO public.system_config (key, value)
VALUES ('walletPrepaymentSplitMode', 'standard')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.scheduled_due_for_payment_date(
  p_schedule jsonb,
  p_payment_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'array' THEN 0::numeric
    ELSE COALESCE(
      (
        SELECT SUM(
          CASE
            WHEN COALESCE(elem->>'status', '') = 'paid' THEN 0::numeric
            WHEN (COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)) <= 0.01 THEN 0::numeric
            WHEN (elem->>'dueDate')::date > p_payment_date THEN 0::numeric
            ELSE COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)
          END
        )
        FROM jsonb_array_elements(p_schedule) AS t(elem)
      ),
      0
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.scheduled_due_strictly_before_payment_date(
  p_schedule jsonb,
  p_payment_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'array' THEN 0::numeric
    ELSE COALESCE(
      (
        SELECT SUM(
          CASE
            WHEN COALESCE(elem->>'status', '') = 'paid' THEN 0::numeric
            WHEN (COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)) <= 0.01 THEN 0::numeric
            WHEN (elem->>'dueDate')::date >= p_payment_date THEN 0::numeric
            ELSE COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)
          END
        )
        FROM jsonb_array_elements(p_schedule) AS t(elem)
      ),
      0
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.record_repayment_wallet_then_recalculate(
  p_loan_id uuid,
  p_borrower_id uuid,
  p_amount numeric,
  p_officer_id uuid,
  p_actual_payment_date date,
  p_prepayment_amount numeric,
  p_scheduled_due_snapshot numeric,
  p_wallet_split_source text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_loan_id IS NULL OR p_borrower_id IS NULL OR p_officer_id IS NULL OR p_actual_payment_date IS NULL THEN
    RAISE EXCEPTION 'loan_id, borrower_id, officer_id, actual_payment_date required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  INSERT INTO public.repayments (
    loan_id,
    borrower_id,
    amount,
    officer_id,
    payment_date,
    actual_payment_date,
    prepayment_amount,
    scheduled_due_snapshot,
    wallet_split_source
  )
  VALUES (
    p_loan_id,
    p_borrower_id,
    p_amount,
    p_officer_id,
    p_actual_payment_date,
    p_actual_payment_date,
    COALESCE(p_prepayment_amount, 0),
    p_scheduled_due_snapshot,
    NULLIF(trim(COALESCE(p_wallet_split_source, '')), '')
  )
  RETURNING id INTO v_id;

  PERFORM public.recalculate_loan_schedule(p_loan_id);

  RETURN v_id;
END;
$$;

-- Mukwano: scheduled cash per repayment (payment-date due first, then FIFO).
-- Prepayment per repayment: forward on installments with dueDate > payment date, then backward overflow.
DROP FUNCTION IF EXISTS public.recalculate_loan_schedule(uuid);

CREATE OR REPLACE FUNCTION public.recalculate_loan_schedule(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  loan_row public.loans%ROWTYPE;
  total_repaid numeric;
  new_sched jsonb := '[]'::jsonb;
  len int;
  i int;
  elem jsonb;
  rem numeric;
  inst_amt numeric;
  alloc numeric;
  need numeric;
  add_amt numeric;
  paid_to_inst numeric;
  st text;
  due date;
  paid_amts numeric[];
  tp numeric;
  rep_row record;
  r_rem numeric;
  payd date;
BEGIN
  SELECT * INTO loan_row FROM public.loans WHERE id = p_loan_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF loan_row.schedule IS NULL OR jsonb_typeof(loan_row.schedule) <> 'array' THEN
    RETURN;
  END IF;

  len := jsonb_array_length(loan_row.schedule);
  IF len IS NULL OR len = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO total_repaid FROM public.repayments WHERE loan_id = p_loan_id;

  paid_amts := array_fill(0::numeric, ARRAY[len]);

  -- Phase 1: scheduled portion per repayment (chronological).
  FOR rep_row IN
    SELECT
      amount,
      COALESCE(prepayment_amount, 0) AS prep,
      actual_payment_date AS payd
    FROM public.repayments
    WHERE loan_id = p_loan_id
    ORDER BY actual_payment_date ASC NULLS LAST, created_at ASC, id ASC
  LOOP
    r_rem := GREATEST(0, COALESCE(rep_row.amount, 0) - COALESCE(rep_row.prep, 0));
    IF r_rem <= 0.01 THEN
      CONTINUE;
    END IF;

    IF rep_row.payd IS NOT NULL THEN
      FOR i IN 0 .. (len - 1) LOOP
        IF r_rem <= 0.01 THEN
          EXIT;
        END IF;
        elem := loan_row.schedule->i;
        inst_amt := COALESCE((elem->>'amount')::numeric, 0);
        IF inst_amt <= 0.01 THEN
          CONTINUE;
        END IF;
        IF (elem->>'dueDate')::date IS DISTINCT FROM rep_row.payd THEN
          CONTINUE;
        END IF;
        need := inst_amt - COALESCE(paid_amts[i + 1], 0);
        IF need <= 0.01 THEN
          CONTINUE;
        END IF;
        alloc := LEAST(r_rem, need);
        paid_amts[i + 1] := COALESCE(paid_amts[i + 1], 0) + alloc;
        r_rem := r_rem - alloc;
        EXIT;
      END LOOP;
    END IF;

    FOR i IN 0 .. (len - 1) LOOP
      IF r_rem <= 0.01 THEN
        EXIT;
      END IF;
      elem := loan_row.schedule->i;
      inst_amt := COALESCE((elem->>'amount')::numeric, 0);
      IF inst_amt <= 0.01 THEN
        CONTINUE;
      END IF;
      need := inst_amt - COALESCE(paid_amts[i + 1], 0);
      IF need <= 0.01 THEN
        CONTINUE;
      END IF;
      alloc := LEAST(r_rem, need);
      paid_amts[i + 1] := COALESCE(paid_amts[i + 1], 0) + alloc;
      r_rem := r_rem - alloc;
    END LOOP;
  END LOOP;

  -- Phase 2: prepayment per repayment — forward on future dues, then backward overflow.
  FOR rep_row IN
    SELECT
      COALESCE(prepayment_amount, 0) AS prep,
      actual_payment_date AS payd
    FROM public.repayments
    WHERE loan_id = p_loan_id
    ORDER BY actual_payment_date ASC NULLS LAST, created_at ASC, id ASC
  LOOP
    r_rem := COALESCE(rep_row.prep, 0);
    IF r_rem <= 0.01 THEN
      CONTINUE;
    END IF;
    payd := rep_row.payd;

    -- Phase 2a Mukwano: forward on installments due after payment date.
    FOR i IN 0 .. (len - 1) LOOP
      IF r_rem <= 0.01 THEN
        EXIT;
      END IF;
      elem := loan_row.schedule->i;
      inst_amt := COALESCE((elem->>'amount')::numeric, 0);
      IF inst_amt <= 0.01 THEN
        CONTINUE;
      END IF;
      due := (elem->>'dueDate')::date;
      IF payd IS NOT NULL AND due IS NOT NULL AND due <= payd THEN
        CONTINUE;
      END IF;
      need := inst_amt - COALESCE(paid_amts[i + 1], 0);
      IF need <= 0.01 THEN
        CONTINUE;
      END IF;
      alloc := LEAST(r_rem, need);
      paid_amts[i + 1] := COALESCE(paid_amts[i + 1], 0) + alloc;
      r_rem := r_rem - alloc;
    END LOOP;

    -- Phase 2b: backward overflow (FCL-style).
    FOR i IN REVERSE (len - 1)..0 LOOP
      IF r_rem <= 0.01 THEN
        EXIT;
      END IF;
      elem := loan_row.schedule->i;
      inst_amt := COALESCE((elem->>'amount')::numeric, 0);
      IF inst_amt <= 0.01 THEN
        CONTINUE;
      END IF;
      need := inst_amt - COALESCE(paid_amts[i + 1], 0);
      IF need <= 0.01 THEN
        CONTINUE;
      END IF;
      add_amt := LEAST(r_rem, need);
      paid_amts[i + 1] := COALESCE(paid_amts[i + 1], 0) + add_amt;
      r_rem := r_rem - add_amt;
    END LOOP;
  END LOOP;

  FOR i IN 0 .. (len - 1) LOOP
    elem := loan_row.schedule->i;
    inst_amt := COALESCE((elem->>'amount')::numeric, 0);
    paid_to_inst := COALESCE(paid_amts[i + 1], 0);
    due := (elem->>'dueDate')::date;
    IF inst_amt <= 0 THEN
      st := 'pending';
    ELSIF paid_to_inst >= inst_amt - 0.01 THEN
      st := 'paid';
    ELSIF due < CURRENT_DATE AND paid_to_inst < inst_amt - 0.01 THEN
      st := 'arrears';
    ELSE
      st := 'pending';
    END IF;
    elem := elem || jsonb_build_object('paidAmount', paid_to_inst, 'status', st);
    new_sched := new_sched || jsonb_build_array(elem);
  END LOOP;

  UPDATE public.loans
  SET
    schedule = new_sched,
    balance = GREATEST(0, loan_row.total_payable - total_repaid),
    outstanding_interest = GREATEST(
      0,
      CASE
        WHEN loan_row.total_payable <= 0 THEN 0
        ELSE (loan_row.total_payable - loan_row.principal)
          * (GREATEST(0, loan_row.total_payable - total_repaid) / NULLIF(loan_row.total_payable, 0))
      END
    )
  WHERE id = p_loan_id;

  tp := NULLIF(loan_row.total_payable, 0);
  IF tp IS NOT NULL AND tp > 0 THEN
    UPDATE public.repayments r
    SET
      principal_paid = ROUND((r.amount * loan_row.principal / tp)::numeric, 2),
      interest_paid = r.amount - ROUND((r.amount * loan_row.principal / tp)::numeric, 2)
    WHERE r.loan_id = p_loan_id
      AND r.amount IS NOT NULL
      AND r.amount > 0
      AND r.principal_paid IS NULL
      AND r.interest_paid IS NULL;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.recalculate_loan_schedule(uuid) IS
  'Mukwano: scheduled cash per repayment (payment-date due first, FIFO). Prepayment: forward on future dues from payment date, then backward overflow.';

CREATE OR REPLACE FUNCTION public.repayment_recompute_prepayment(p_repayment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.repayments%ROWTYPE;
  orig_amt numeric;
  due numeric;
  mode text;
BEGIN
  SELECT * INTO r FROM public.repayments WHERE id = p_repayment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repayment not found';
  END IF;

  orig_amt := r.amount;

  SELECT COALESCE(
    (SELECT value FROM public.system_config WHERE key = 'walletPrepaymentSplitMode' LIMIT 1),
    'standard'
  ) INTO mode;

  UPDATE public.repayments SET amount = 0 WHERE id = p_repayment_id;
  PERFORM public.recalculate_loan_schedule(r.loan_id);

  IF mode = 'arrears_only' THEN
    SELECT COALESCE(
      public.scheduled_due_strictly_before_payment_date(l.schedule, r.actual_payment_date::date),
      0
    ) INTO due
    FROM public.loans l
    WHERE l.id = r.loan_id;
  ELSE
    SELECT COALESCE(
      public.scheduled_due_for_payment_date(l.schedule, r.actual_payment_date::date),
      0
    ) INTO due
    FROM public.loans l
    WHERE l.id = r.loan_id;
  END IF;

  UPDATE public.repayments
  SET
    amount = orig_amt,
    prepayment_amount = GREATEST(0, orig_amt - due),
    scheduled_due_snapshot = due,
    wallet_split_source = 'rpc'
  WHERE id = p_repayment_id;

  PERFORM public.recalculate_loan_schedule(r.loan_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.scheduled_due_for_payment_date(jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scheduled_due_strictly_before_payment_date(jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_repayment_wallet_then_recalculate(
  uuid, uuid, numeric, uuid, date, numeric, numeric, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_repayment_wallet_then_recalculate(
  uuid, uuid, numeric, uuid, date, numeric, numeric, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.repayment_recompute_prepayment(uuid) TO authenticated;
