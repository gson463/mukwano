-- Run in SQL Editor if a previous attempt failed partway (23505 on phone or ID unique).
-- Safe to run multiple times. Then run migration 20260426160000_borrower_duplicate_of_and_partial_uniques.sql
-- (or section 3 of APPLY_ALL_MIGRATIONS.sql).

DROP INDEX IF EXISTS public.idx_borrowers_phone_norm_unique;
DROP INDEX IF EXISTS public.idx_borrowers_ident_norm_unique;
