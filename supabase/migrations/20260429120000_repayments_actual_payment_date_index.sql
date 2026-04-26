-- Speeds up admin / reports queries that filter and order by payment date (avoids statement timeouts).

CREATE INDEX IF NOT EXISTS idx_repayments_actual_payment_date
  ON public.repayments (actual_payment_date DESC);

COMMENT ON INDEX idx_repayments_actual_payment_date IS 'Admin repayments list and reports: range + order by actual_payment_date.';
