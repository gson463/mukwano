-- Mark existing duplicate phone/ID rows (data kept as-is); only one "canonical" row per phone/ID enforces uniqueness.
-- Replaces full unique indexes with partial indexes (canonical rows only: duplicate_of_borrower_id IS NULL).

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

-- Self-FK after column exists (avoid NOT VALID if you need immediate checks)
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

-- 1) Ident first: same normalized NIDA → keeper = min(id) (applies to all rows in group)
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

-- 2) Phone: same normalized phone, among rows still canonical (not yet a duplicate)
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

-- RPC unchanged: still blocks new registration if phone/ID matches any row
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
