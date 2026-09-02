-- Backfill prepayment_amount / scheduled_due_snapshot / wallet_split_source on existing repayments.
-- Runs in batches via backfill_repayment_wallet_split_batch() to avoid statement timeout on large datasets.

CREATE OR REPLACE FUNCTION public.backfill_repayment_wallet_split_batch(p_batch_size int DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  n int := 0;
  remaining bigint;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 500;
  END IF;

  FOR rec IN
    SELECT id
    FROM public.repayments
    WHERE wallet_split_source IS NULL
    ORDER BY loan_id, COALESCE(actual_payment_date::date, payment_date::date), id
    LIMIT p_batch_size
  LOOP
    PERFORM public.repayment_recompute_prepayment(rec.id);
    n := n + 1;
  END LOOP;

  SELECT COUNT(*) INTO remaining
  FROM public.repayments
  WHERE wallet_split_source IS NULL;

  RETURN jsonb_build_object(
    'processed', n,
    'remaining', remaining
  );
END;
$$;

COMMENT ON FUNCTION public.backfill_repayment_wallet_split_batch(int) IS
  'Recompute wallet split for up to p_batch_size repayments missing wallet_split_source. Call repeatedly until remaining=0.';

GRANT EXECUTE ON FUNCTION public.backfill_repayment_wallet_split_batch(int) TO service_role;
