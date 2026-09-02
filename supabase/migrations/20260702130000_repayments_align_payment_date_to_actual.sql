-- payment_date must match actual_payment_date (business day cash was received).
-- Legacy rows sometimes stored installment due dates in payment_date.

UPDATE public.repayments
SET payment_date = actual_payment_date
WHERE payment_date IS DISTINCT FROM actual_payment_date;

COMMENT ON COLUMN public.repayments.payment_date IS
  'Same as actual_payment_date: calendar day the repayment was received (EAT business date).';

COMMENT ON COLUMN public.repayments.actual_payment_date IS
  'Calendar day the repayment was received (EAT business date). Used for history, filters, and reports.';
